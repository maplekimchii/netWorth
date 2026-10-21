"use server";
// Every form in the app posts to one of these. Each checks the session first.
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { companies, emailTemplates, messages, profile } from "@/db/schema";
import * as ai from "@/lib/ai";
import * as data from "@/lib/data";
import * as importers from "@/lib/importers";
import { go, requireUser } from "@/lib/session";
import { AIError, unfilled } from "@/lib/templating";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const optInt = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);
const refresh = () => revalidatePath("/", "layout");

/** AI failures become a message for the page instead of a crash. */
function aiError(e: unknown): { error: string } {
  if (e instanceof AIError || e instanceof OpenAI.APIError) return { error: `Error: ${e.message}` };
  throw e;
}

function contactFields(fd: FormData): data.ContactFields {
  return Object.fromEntries([...data.CONTACT_TEXT_FIELDS, "gradYear"].map((k) => [k, s(fd, k)]));
}

// --- contacts ---

export async function addContact(fd: FormData) {
  await requireUser();
  const source = s(fd, "source") || "paste";
  if (!(data.SOURCES as readonly string[]).includes(source)) throw new Error("Bad source");
  let id: number | null;
  try {
    id = await data.addContact(s(fd, "name"), source as data.Source, s(fd, "company"), contactFields(fd));
  } catch (e) {
    go("/contacts", (e as Error).message);
  }
  if (id === null) go("/contacts", `${s(fd, "name")} at ${s(fd, "company") || "no company"} is already saved.`);
  go(`/contacts/${id}`);
}

export async function updateContact(id: number, fd: FormData) {
  await requireUser();
  await data.updateContact(id, s(fd, "name"), s(fd, "company"), contactFields(fd));
  go(`/contacts/${id}`, "Saved.");
}

export async function setStatus(id: number, fd: FormData) {
  await requireUser();
  await data.setStatus(id, s(fd, "status"));
  refresh();
}

export type Draft = { subject: string; body: string; kind: "initial" | "followup"; unfilled: string[] };
export type DraftState = { draft?: Draft; error?: string } | null;

export async function draftWithAI(contactId: number, _prev: DraftState, fd: FormData): Promise<DraftState> {
  await requireUser();
  const c = await data.getContact(contactId);
  const [tpl] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, Number(fd.get("templateId"))));
  if (!c || !tpl) return { error: "Contact or template not found." };
  const [co] = c.companyId ? await db.select().from(companies).where(eq(companies.id, c.companyId)) : [];
  const prior = await db.select().from(messages).where(eq(messages.contactId, contactId)).orderBy(messages.id);
  try {
    const { subject, body } = await ai.draft(tpl, await data.getProfile(), c, co ?? null, prior);
    return { draft: { subject, body, kind: tpl.kind, unfilled: unfilled(`${subject}\n${body}`) } };
  } catch (e) {
    return aiError(e);
  }
}

export async function saveDraft(contactId: number, fd: FormData) {
  await requireUser();
  const kind = s(fd, "kind") === "followup" ? "followup" : "initial";
  await data.recordDraft(contactId, kind, s(fd, "subject"), String(fd.get("body") ?? ""));
  go(`/contacts/${contactId}`, "Draft saved.");
}

export async function markSent(messageId: number) {
  await requireUser();
  await data.markSent(messageId);
  refresh();
}

export async function markReplied(messageId: number) {
  await requireUser();
  await data.markReplied(messageId);
  refresh();
}

// --- companies ---

export async function addCompany(fd: FormData) {
  await requireUser();
  const id = await data.getOrCreateCompany(s(fd, "name"));
  go(id ? `/companies/${id}` : "/companies");
}

export async function updateCompany(id: number, fd: FormData) {
  await requireUser();
  await db.update(companies).set({
    domain: s(fd, "domain"), industry: s(fd, "industry"), priority: optInt(s(fd, "priority")) ?? 2, notes: s(fd, "notes"),
  }).where(eq(companies.id, id));
  go(`/companies/${id}`, "Saved.");
}

export async function refreshNews(id: number) {
  await requireUser();
  const [co] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, id));
  if (!co) go("/companies");
  let msg: string | undefined;
  try {
    const news = await ai.researchCompany(co.name);
    await db.update(companies).set({ news, newsUpdatedAt: new Date() }).where(eq(companies.id, id));
  } catch (e) {
    msg = aiError(e).error;
  }
  go(`/companies/${id}`, msg);
}

// --- find ---

export type Found = ai.FoundPerson & { company: string; saved: boolean };
export type FindState = { people?: Found[]; error?: string } | null;

export async function findPeople(_prev: FindState, fd: FormData): Promise<FindState> {
  await requireUser();
  const company = s(fd, "company");
  try {
    const people = await ai.findPeople(company, s(fd, "focus"), await data.getProfile());
    if (!people.length) return { error: "No people found. Try a broader focus." };
    return {
      people: await Promise.all(people.map(async (p) => ({ ...p, company, saved: await data.contactExists(p.name, company) }))),
    };
  } catch (e) {
    return aiError(e);
  }
}

export async function addFound(fd: FormData) {
  await requireUser();
  let added = 0, skipped = 0;
  for (const raw of fd.getAll("pick")) {
    const p = JSON.parse(String(raw)) as Found;
    const notes = `${p.why_relevant ?? ""}\nSource: ${p.source_url ?? ""}`.trim();
    const id = await data.addContact(p.name, "ai_search", p.company, {
      title: p.title ?? "", linkedinUrl: p.linkedin_url ?? "", notes,
    });
    if (id) added++;
    else skipped++;
  }
  go("/contacts", `Added ${added} to contacts${skipped ? `, ${skipped} already saved.` : "."}`);
}

export type ParseState = { parsed?: ai.Parsed; error?: string } | null;

export async function parseProfile(_prev: ParseState, fd: FormData): Promise<ParseState> {
  await requireUser();
  try {
    return { parsed: await ai.parseProfile(s(fd, "text")) };
  } catch (e) {
    return aiError(e);
  }
}

// --- applications ---

export async function addApplication(fd: FormData) {
  await requireUser();
  try {
    await data.addApplication(s(fd, "company"), s(fd, "role"), s(fd, "url"), optInt(s(fd, "referrerContactId")));
  } catch (e) {
    go("/applications", (e as Error).message);
  }
  refresh();
}

export async function updateApplication(id: number, fd: FormData) {
  await requireUser();
  await data.updateApplication(id, s(fd, "status"), optInt(s(fd, "referrerContactId")));
  refresh();
}

// --- templates and profile ---

export async function saveTemplate(fd: FormData) {
  await requireUser();
  const values = {
    name: s(fd, "name"), kind: s(fd, "kind") === "followup" ? "followup" as const : "initial" as const,
    subject: s(fd, "subject"), body: String(fd.get("body") ?? ""),
  };
  const id = optInt(s(fd, "id"));
  if (id) await db.update(emailTemplates).set(values).where(eq(emailTemplates.id, id));
  else await db.insert(emailTemplates).values(values);
  go("/templates", "Template saved.");
}

export async function saveProfile(fd: FormData) {
  await requireUser();
  await db.update(profile).set({
    name: s(fd, "name"), program: s(fd, "program"), resumeText: String(fd.get("resumeText") ?? ""),
    story: String(fd.get("story") ?? ""), targetRoles: s(fd, "targetRoles"),
    voiceSamples: String(fd.get("voiceSamples") ?? ""), followupDays: optInt(s(fd, "followupDays")) || 5,
  }).where(eq(profile.id, 1));
  go("/profile", "Profile saved.");
}

// --- import ---
// The browser keeps the uploaded file and sends it again on each step, so nothing is stored between steps.

export type ImportState = {
  report?: importers.Report; error?: string;
  table?: Omit<importers.Table, "rows"> & { preview: Record<string, string>; mapping: Record<string, string> };
} | null;

async function file(fd: FormData) {
  const f = fd.get("file");
  if (!(f instanceof File) || !f.size) throw new Error("Choose a file first.");
  return { name: f.name, data: Buffer.from(await f.arrayBuffer()) };
}

export async function importLinkedin(_prev: ImportState, fd: FormData): Promise<ImportState> {
  await requireUser();
  try {
    const report = await importers.importLinkedin((await file(fd)).data);
    refresh();
    return { report };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function importSheet(_prev: ImportState, fd: FormData): Promise<ImportState> {
  await requireUser();
  try {
    const f = await file(fd);
    const { rows, ...table } = await importers.readTable(f.name, f.data, s(fd, "sheet") || undefined);
    if (fd.get("step") !== "import") {
      return { table: { ...table, preview: rows[0] ?? {}, mapping: await importers.savedMapping(table.headers) } };
    }
    const mapping = Object.fromEntries(table.headers.map((h, i) => [h, s(fd, `map_${i}`)]));
    await importers.saveMapping(table.headers, mapping);
    const report = await importers.importRows(rows, mapping, "import");
    refresh();
    return { report };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
