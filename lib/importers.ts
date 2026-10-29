// LinkedIn and spreadsheet import, Excel export. Port of v1 importers.py.
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { and, eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import * as t from "@/db/schema";
import { addContact, cleanName, getOrCreateCompany, type ContactFields, type Source } from "./data";

// Field keys as shown in the mapping dropdown, and the contact column each one fills.
export const FIELDS = [
  "name", "first_name", "last_name", "company", "title", "email", "linkedin_url", "how_connected", "notes",
  "team", "school", "program", "grad_year", "location", "gender", "source", "industry", "custom_field",
] as const;
type Field = (typeof FIELDS)[number];
const FIELD_KEY: Partial<Record<Field, Exclude<keyof ContactFields, "attributes">>> = {
  title: "title", email: "email", linkedin_url: "linkedinUrl", how_connected: "howConnected", notes: "notes",
  team: "team", school: "school", program: "program", grad_year: "gradYear", location: "location", gender: "gender",
};
const LINKEDIN_MAPPING: Record<string, Field> = {
  "First Name": "first_name", "Last Name": "last_name", "Email Address": "email",
  Company: "company", Position: "title", URL: "linkedin_url",
};

export type Report = { added: number; skipped: number; failed: string[] };
type Row = Record<string, string>;

export async function importRows(rows: Row[], mapping: Record<string, string>, source: Source, howConnected = "") {
  const report: Report = { added: 0, skipped: 0, failed: [] };
  for (const [i, row] of rows.entries()) {
    const f: Partial<Record<Field, string>> = {};
    const custom: Record<string, string> = {}; // columns kept as-is under their header, e.g. {"Function": "Private Equity"}
    for (const [col, field] of Object.entries(mapping)) {
      const v = (row[col] ?? "").trim();
      if (field === "custom_field") { if (v) custom[col] = v; }
      else if ((FIELDS as readonly string[]).includes(field)) f[field as Field] = v;
    }
    const name = f.name || `${f.first_name ?? ""} ${f.last_name ?? ""}`;
    if (!cleanName(name)) {
      report.failed.push(`row ${i + 1}: missing name`);
      continue;
    }
    const fields: ContactFields = {};
    for (const [field, key] of Object.entries(FIELD_KEY)) fields[key] = f[field as Field] ?? "";
    fields.howConnected = fields.howConnected || howConnected;
    // Where the sheet says the person was found (PitchBook, LinkedIn). contacts.source is how they entered this app.
    const attributes = { ...custom, ...(f.source ? { source: f.source } : {}) };
    if (Object.keys(attributes).length) fields.attributes = attributes;
    if ((await addContact(name, source, f.company ?? "", fields)) === null) report.skipped++;
    else report.added++;
    // Industry belongs to the company. Fill it only when empty, like AI enrichment does.
    const companyId = f.industry && (await getOrCreateCompany(f.company));
    if (companyId) {
      await db.update(t.companies).set({ industry: f.industry })
        .where(and(eq(t.companies.id, companyId), eq(t.companies.industry, "")));
    }
  }
  return report;
}

async function csvGrid(data: Buffer): Promise<string[][]> {
  const ws = await new ExcelJS.Workbook().csv.read(Readable.from(data.toString("utf8").replace(/^﻿/, "")), {
    map: (v: unknown) => String(v ?? ""), // keep cells as text: no number or date conversion
  });
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (r) => {
    grid.push(Array.from({ length: r.cellCount }, (_, i) => r.getCell(i + 1).text));
  });
  return grid;
}

export async function importLinkedin(data: Buffer) {
  const grid = await csvGrid(data);
  const start = grid.findIndex((r) => r[0]?.trim() === "First Name");
  if (start === -1) throw new Error("This is not a LinkedIn Connections.csv (no 'First Name' header found).");
  return importRows(toRows(grid, start), LINKEDIN_MAPPING, "linkedin_csv", "1st-degree LinkedIn connection");
}

function toRows(grid: string[][], start: number): Row[] {
  const headers = grid[start].map((h) => h.trim());
  return grid.slice(start + 1).filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

export type Table = { sheets: string[]; sheet: string; headers: string[]; rows: Row[] };

// ExcelJS 4.4 only finds tables linked as "../tables/x.xml" and crashes on the absolute
// "/xl/tables/x.xml" that openpyxl writes, so rewrite those links before loading.
async function relativeTableLinks(data: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(data);
  const rels = zip.file(/^xl\/worksheets\/_rels\/[^/]+\.rels$/);
  for (const f of rels) zip.file(f.name, (await f.async("string")).replaceAll('Target="/xl/tables/', 'Target="../tables/'));
  return rels.length ? zip.generateAsync({ type: "nodebuffer" }) : data;
}

export async function readTable(filename: string, data: Buffer, sheet?: string): Promise<Table> {
  let sheets: string[], grid: string[][];
  const links: string[][] = [];
  if (filename.toLowerCase().endsWith(".csv")) {
    sheets = ["CSV"];
    grid = await csvGrid(data);
  } else {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load((await relativeTableLinks(data)) as unknown as ArrayBuffer);
    } catch {
      throw new Error(`Could not read ${filename}. Upload an .xlsx or .csv file.`);
    }
    sheets = wb.worksheets.map((w) => w.name);
    const ws = wb.worksheets.find((w) => w.name === sheet) ?? wb.worksheets[0];
    grid = [];
    ws?.eachRow({ includeEmpty: true }, (r) => {
      const cells = Array.from({ length: r.cellCount }, (_, i) => r.getCell(i + 1));
      grid.push(cells.map((c) => c.text ?? ""));
      links.push(cells.map((c) => c.hyperlink ?? ""));
    });
  }
  const chosen = sheets.includes(sheet ?? "") ? sheet! : sheets[0];
  // Exports such as PitchBook put title rows above the header: take the first row with 2+ filled cells.
  const start = grid.findIndex((r) => r.filter((v) => v.trim()).length >= 2);
  if (start === -1) return { sheets, sheet: chosen, headers: [], rows: [] };
  // A cell can show "Profile" over a LinkedIn URL. Offer each linked column's URLs as "<header> (link)".
  const width = grid[start].length;
  const linked = grid[start].map((_, i) => i).filter((i) => links.slice(start + 1).some((r) => r[i]));
  if (linked.length) {
    grid = grid.map((r, n) => [...Array.from({ length: width }, (_, i) => r[i] ?? ""),
      // Rows that typed the URL instead of linking it fill the same column, so one mapping covers both.
      ...linked.map((i) => (n === start ? `${grid[start][i].trim()} (link)`
        : links[n]?.[i] || (/^https?:\/\//i.test(r[i]?.trim() ?? "") ? r[i].trim() : "")))]);
  }
  return { sheets, sheet: chosen, headers: grid[start].map((h) => h.trim()), rows: toRows(grid, start) };
}

const signature = (headers: string[]) => headers.map((h) => h.toLowerCase()).join("|");

export async function savedMapping(headers: string[]): Promise<Record<string, string>> {
  const [row] = await db.select().from(t.columnMappings).where(eq(t.columnMappings.signature, signature(headers)));
  return row?.mapping ?? {};
}

export async function saveMapping(headers: string[], mapping: Record<string, string>) {
  await db.insert(t.columnMappings).values({ signature: signature(headers), mapping })
    .onConflictDoUpdate({ target: t.columnMappings.signature, set: { mapping } });
}

export async function exportXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const tables = {
    contacts: t.contacts, companies: t.companies, messages: t.messages, applications: t.applications,
    email_templates: t.emailTemplates, profile: t.profile,
  };
  for (const [name, table] of Object.entries(tables)) {
    const rows = (await db.select().from(table)) as Record<string, unknown>[];
    const ws = wb.addWorksheet(name);
    const cols = Object.keys(getTableColumns(table));
    ws.addRow(cols);
    for (const r of rows) ws.addRow(cols.map((c) => (r[c] !== null && typeof r[c] === "object" && !(r[c] instanceof Date) ? JSON.stringify(r[c]) : r[c])));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
