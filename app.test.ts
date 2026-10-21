// Port of the v1 pytest suite. Postgres runs in memory (PGlite) with the real migrations; OpenAI is faked.
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import * as data from "@/lib/data";
import * as ai from "@/lib/ai";
import * as importers from "@/lib/importers";
import { composeUrl, niceDate, safeUrl, today } from "@/lib/format";
import { AIError, applySlots, extractSlots, fillData, parseJson, unfilled } from "@/lib/templating";

vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const schema = await import("@/db/schema");
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
  return { db };
});

const openaiCalls: Record<string, unknown>[] = [];
let openaiReply = '{"ok": true}';
vi.mock("openai", () => {
  class APIError extends Error {}
  class OpenAI {
    static APIError = APIError;
    responses = { create: async (args: Record<string, unknown>) => { openaiCalls.push(args); return { output_text: openaiReply }; } };
  }
  return { default: OpenAI };
});

const run = (q: ReturnType<typeof sql>) => db.execute(q);

beforeEach(async () => {
  await run(sql`truncate contacts, companies, messages, applications, column_mappings, jobs, job_items restart identity cascade`);
  await run(sql`update profile set followup_days = 5, name = '', program = '', target_roles = '', voice_samples = ''`);
  openaiCalls.length = 0;
});

async function sentContact(sent = "2026-10-01T09:00:00Z") {
  const cid = (await data.addContact("Jane Doe", "paste", "Stripe"))!;
  const mid = await data.recordDraft(cid, "initial", "Hi", "Body");
  await data.markSent(mid, new Date(sent));
  return { cid, mid };
}

describe("data rules", () => {
  it("skips a duplicate: same name and company, ignoring case and spacing", async () => {
    expect(await data.addContact("Jane Doe", "paste", "Stripe")).toBeTruthy();
    expect(await data.addContact("  jane   doe ", "paste", "stripe")).toBeNull();
    expect(await data.addContact("Jane Doe", "paste", "Figma")).toBeTruthy();
    expect(await data.addContact("Jane Doe", "paste")).toBeTruthy();
    expect(await data.addContact("jane doe", "paste")).toBeNull();
  });

  it("requires a name", async () => {
    await expect(data.addContact("   ", "paste")).rejects.toThrow("needs a name");
  });

  it("draft then sent sets the follow-up date", async () => {
    const cid = (await data.addContact("Jane Doe", "paste", "Stripe"))!;
    const mid = await data.recordDraft(cid, "initial", "Hi", "Body");
    expect((await data.getContact(cid))!.status).toBe("drafted");
    await data.markSent(mid, new Date("2026-10-01T09:00:00Z"));
    const c = (await data.getContact(cid))!;
    expect([c.status, c.nextFollowupDate, c.followupCount]).toEqual(["sent", "2026-10-06", 0]);
  });

  it("uses the follow-up days setting", async () => {
    await run(sql`update profile set followup_days = 7`);
    const { cid } = await sentContact();
    expect((await data.getContact(cid))!.nextFollowupDate).toBe("2026-10-08");
  });

  it("counts sent follow-ups and keeps the contact due", async () => {
    const { cid } = await sentContact();
    for (const sent of ["2026-10-06T09:00:00Z", "2026-10-11T09:00:00Z"]) {
      await data.markSent(await data.recordDraft(cid, "followup", "Re: Hi", "Nudge"), new Date(sent));
    }
    const c = (await data.getContact(cid))!;
    expect([c.followupCount, c.nextFollowupDate]).toEqual([2, "2026-10-16"]);
    const due = (await data.todayView("2026-10-16")).due;
    expect(due.map((r) => r.id)).toEqual([cid]);
    expect(due[0].daysLate).toBe(0);
  });

  it("marking sent twice is a no-op", async () => {
    const { cid, mid } = await sentContact();
    await data.markSent(mid, new Date("2026-10-09T09:00:00Z"));
    expect((await data.getContact(cid))!.nextFollowupDate).toBe("2026-10-06");
  });

  it("a reply clears the follow-up", async () => {
    const { cid, mid } = await sentContact();
    await data.markReplied(mid, new Date("2026-10-02T10:00:00Z"));
    const c = (await data.getContact(cid))!;
    expect([c.status, c.nextFollowupDate]).toEqual(["replied", null]);
    expect((await data.todayView("2026-10-30")).due).toEqual([]);
  });

  it("a manual status overrides automation", async () => {
    const { cid, mid } = await sentContact();
    await data.setStatus(cid, "call");
    expect((await data.getContact(cid))!.nextFollowupDate).toBeNull();
    await data.markReplied(mid, new Date("2026-10-02T10:00:00Z"));
    expect((await data.getContact(cid))!.status).toBe("call");
  });

  it("Today lists old unsent drafts and stale applications", async () => {
    const cid = (await data.addContact("Jane Doe", "paste", "Stripe"))!;
    await data.recordDraft(cid, "initial", "Hi", "Body");
    await run(sql`update messages set created_at = '2026-10-01 12:00:00+00'`);
    await data.addApplication("Stripe", "PM Intern");
    await run(sql`update applications set updated_at = '2026-09-01 12:00:00+00'`);
    expect((await data.todayView("2026-10-02")).unsent).toEqual([]);
    const view = await data.todayView("2026-10-03");
    expect(view.unsent).toHaveLength(1);
    expect(view.staleApps.map((a) => a.role)).toEqual(["PM Intern"]);
  });

  it("an application status change sets the applied date and bumps updated_at", async () => {
    await data.addApplication("Stripe", "PM Intern");
    await run(sql`update applications set updated_at = '2026-09-01 12:00:00+00'`);
    await data.updateApplication(1, "applied", null);
    const { rows: [a] } = await run(sql`select applied_date, updated_at from applications where id = 1`) as unknown as { rows: { applied_date: string; updated_at: Date }[] };
    expect(a.applied_date).toBeTruthy();
    expect(new Date(a.updated_at) > new Date("2026-09-01T12:00:00Z")).toBe(true);
  });

  it("stats for the Today tiles", async () => {
    await sentContact("2026-10-08T09:00:00Z"); // sent this week, due 10-13
    const b = (await data.addContact("Ann Lee", "paste", "Figma"))!;
    const mb = await data.recordDraft(b, "initial", "Hi", "Body");
    await data.markSent(mb, new Date("2026-09-20T09:00:00Z"));
    await data.markReplied(mb, new Date("2026-09-21T09:00:00Z"));
    const c = (await data.addContact("Sam Wu", "paste"))!;
    await data.markSent(await data.recordDraft(c, "initial", "Hi", "Body"), new Date("2026-10-01T09:00:00Z")); // overdue
    await data.setStatus(b, "call");
    expect(await data.stats("2026-10-10")).toEqual({ due: 1, sentWeek: 1, replyRate: 33, calls: 1 });
  });

  it("has no reply rate without sends", async () => {
    expect((await data.stats("2026-10-10")).replyRate).toBeNull();
  });

  it("contactExists uses the duplicate rule without creating the company", async () => {
    await data.addContact("Jane Doe", "paste", "Stripe");
    expect(await data.contactExists(" jane  doe", "STRIPE")).toBe(true);
    expect(await data.contactExists("Jane Doe", "Figma")).toBe(false);
    expect(await data.contactExists("Jane Doe", "New Co")).toBe(false);
    const { rows } = await run(sql`select count(*)::int as n from companies`) as unknown as { rows: { n: number }[] };
    expect(rows[0].n).toBe(1);
  });

  it("searches contacts by name, title, or company", async () => {
    await data.addContact("Jane Doe", "paste", "Stripe", { title: "Product Manager" });
    await data.addContact("Ann Lee", "paste", "Figma", { title: "Recruiter" });
    const names = async (q: string) => (await data.listContacts({ q })).map((r) => r.name);
    expect(await names("jane")).toEqual(["Jane Doe"]);
    expect(await names("figma")).toEqual(["Ann Lee"]);
    expect(await names("product")).toEqual(["Jane Doe"]);
    expect(await names("")).toEqual(["Ann Lee", "Jane Doe"]);
  });

  it("stores graph fields, with a blank grad year as null", async () => {
    const id = (await data.addContact("Jane Doe", "paste", "Stripe", { school: "Waterloo", gradYear: "2024", team: "Payments" }))!;
    expect((await data.getContact(id))!).toMatchObject({ school: "Waterloo", gradYear: 2024, team: "Payments" });
    await data.updateContact(id, "Jane Doe", "Stripe", { gradYear: "" });
    expect((await data.getContact(id))!.gradYear).toBeNull();
  });
});

describe("templating", () => {
  it("leaves unknown and empty placeholders visible", () => {
    const out = fillData("Hi {first_name} at {company}, {mystery}", { first_name: "Jane", company: "" });
    expect(out).toBe("Hi Jane at {company}, {mystery}");
    expect(unfilled(`${out} [[hook: x]]`)).toEqual(["{company}", "{mystery}", "[[hook: x]]"]);
  });

  it("extracts slots and keeps a missing slot's marker", () => {
    const text = "A [[hook: why them]] B [[why_company: why\nStripe]]";
    expect(extractSlots(text)).toEqual({ hook: "why them", why_company: "why\nStripe" });
    expect(applySlots(text, { hook: " We both did CS. " })).toBe("A We both did CS. B [[why_company: why\nStripe]]");
  });

  it("parses JSON inside fences and prose", () => {
    expect(parseJson('Sure!\n```json\n{"a": [1]}\n```')).toEqual({ a: [1] });
    expect(() => parseJson("no json here")).toThrow(AIError);
    expect(() => parseJson("{not: valid}")).toThrow(AIError);
  });
});

describe("ai", () => {
  const profile = { name: "Alex Lee", program: "CS", targetRoles: "Product, eng", voiceSamples: "hey!", story: "", resumeText: "", followupDays: 5 };
  const contact = { name: "Cher", title: "", company: "Stripe", howConnected: "", notes: "" };

  it("fills data first, then sends only the slots to the AI", async () => {
    process.env.OPENAI_API_KEY = "test";
    openaiReply = '{"hook": "Loved your talk."}';
    const tpl = { subject: "{target_role} at {company}", body: "Hi {first_name},\n[[hook: about {company}]]\n{my_name}" };
    expect(await ai.draft(tpl, profile, contact, null, [])).toEqual({ subject: "Product at Stripe", body: "Hi Cher,\nLoved your talk.\nAlex Lee" });
    const input = String(openaiCalls[0].input);
    expect(input).toContain('- "hook": about Stripe');
    expect(input).toContain("hey!");
    expect(openaiCalls[0].tools).toBeUndefined();
  });

  it("makes no AI call for a template without slots", async () => {
    expect(await ai.draft({ subject: "Hi", body: "Hi {first_name}" }, profile, { ...contact, name: "Jane Doe" }, null, []))
      .toEqual({ subject: "Hi", body: "Hi Jane" });
    expect(openaiCalls).toHaveLength(0);
  });

  it("uses web search only for research calls", async () => {
    process.env.OPENAI_API_KEY = "test";
    openaiReply = '{"bullets": ["Raised a Series B (Oct 2026)"]}';
    expect(await ai.researchCompany("Stripe")).toBe("- Raised a Series B (Oct 2026)");
    expect(openaiCalls[0].tools).toEqual([{ type: "web_search" }]);
  });

  it("turns a missing API key into a readable error", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(ai.researchCompany("Stripe")).rejects.toThrow("OPENAI_API_KEY");
  });
});

describe("importers", () => {
  const LINKEDIN_CSV = Buffer.from("﻿Notes:\n"
    + '"When exporting your connection data, you may notice that some of the email addresses are missing."\n'
    + "\n"
    + "First Name,Last Name,URL,Email Address,Company,Position,Connected On\n"
    + "Jane,Doe,https://www.linkedin.com/in/janedoe,,Stripe,PM,01 Oct 2026\n"
    + "Bob,,https://www.linkedin.com/in/bob,,,,02 Oct 2026\n"
    + ",,,,,,\n"
    + "Jane,Doe,https://www.linkedin.com/in/janedoe,,Stripe,PM,01 Oct 2026\n");

  it("handles the BOM, preamble, blank rows, and duplicates in LinkedIn CSV", async () => {
    // Blank rows are skipped, not reported as failures (v1 reported ",,,,,," as "row 3: missing name").
    expect(await importers.importLinkedin(LINKEDIN_CSV)).toEqual({ added: 2, skipped: 1, failed: [] });
    const [jane] = (await data.listContacts({ source: "linkedin_csv" })).filter((c) => c.name === "Jane Doe");
    expect([jane.company, jane.title, jane.howConnected]).toEqual(["Stripe", "PM", "1st-degree LinkedIn connection"]);
  });

  it("rejects a CSV that is not LinkedIn's", async () => {
    await expect(importers.importLinkedin(Buffer.from("a,b\n1,2\n"))).rejects.toThrow("First Name");
  });

  it("skips title rows in Excel and remembers the mapping", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["PitchBook search results"]);
    ws.addRow([]);
    ws.addRow(["Full Name", "Employer", "Job Title"]);
    ws.addRow(["Ann Lee", "Figma", "Recruiter"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const t = await importers.readTable("people.xlsx", buf);
    expect(t.headers).toEqual(["Full Name", "Employer", "Job Title"]);
    expect(t.rows).toEqual([{ "Full Name": "Ann Lee", Employer: "Figma", "Job Title": "Recruiter" }]);
    const mapping = { "Full Name": "name", Employer: "company", "Job Title": "title" };
    await importers.saveMapping(t.headers, mapping);
    expect(await importers.savedMapping(t.headers)).toEqual(mapping);
    expect((await importers.importRows(t.rows, mapping, "import")).added).toBe(1);
  });

  it("rejects garbage instead of an .xlsx", async () => {
    await expect(importers.readTable("people.xlsx", Buffer.from("not an excel file"))).rejects.toThrow("Could not read");
  });

  it("exports one sheet per table", async () => {
    await data.addContact("Jane Doe", "paste");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await importers.exportXlsx()) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(["contacts", "companies", "messages", "applications"]));
    expect(wb.getWorksheet("contacts")!.getCell("B2").value).toBe("Jane Doe");
  });
});

describe("format", () => {
  it("blocks script links", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl(" JaVaScRiPt:alert(1)")).toBe("#");
    expect(safeUrl("https://www.linkedin.com/in/x")).toBe("https://www.linkedin.com/in/x");
    expect(safeUrl("")).toBe("#");
  });

  it("formats dates", () => {
    expect(niceDate(`${today().slice(0, 4)}-10-03`)).toBe("Oct 3");
    expect(niceDate("2019-01-09 10:00:00")).toBe("Jan 9, 2019");
    expect(niceDate(null)).toBe("");
    expect(today(new Date("2026-10-21T03:00:00Z"))).toBe("2026-10-20"); // still the 20th in Toronto
  });

  it("builds an Outlook compose link with spaces as %20", () => {
    const u = new URL(composeUrl("jane@stripe.com", "Hi there", "Line 1\nA & B"));
    expect(u.origin + u.pathname).toBe("https://outlook.office.com/mail/deeplink/compose");
    expect(u.searchParams.get("body")).toBe("Line 1\nA & B");
    expect(u.search).not.toContain("+");
  });
});
