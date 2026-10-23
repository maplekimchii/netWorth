// Port of the v1 pytest suite. Postgres runs in memory (PGlite) with the real migrations; OpenAI is faked.
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import * as schema from "@/db/schema";
import * as data from "@/lib/data";
import * as ai from "@/lib/ai";
import * as importers from "@/lib/importers";
import * as jobs from "@/lib/jobs";
import { buildTree, parseLevels, type GraphContact } from "@/lib/graph";
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

  it("reads Excel tables linked by absolute path, as openpyxl writes them", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Contacts").addTable({
      name: "Contacts", ref: "A1", columns: [{ name: "Name" }, { name: "Company" }], rows: [["Ann Lee", "Figma"]],
    });
    const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
    const rels = "xl/worksheets/_rels/sheet1.xml.rels";
    zip.file(rels, (await zip.file(rels)!.async("string")).replace('Target="../tables/', 'Target="/xl/tables/'));
    const t = await importers.readTable("people.xlsx", await zip.generateAsync({ type: "nodebuffer" }));
    expect(t.rows).toEqual([{ Name: "Ann Lee", Company: "Figma" }]);
  });

  it("offers the URL behind a linked cell as its own column", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Name", "LinkedIn", "Notes"]);
    ws.addRow(["Ann Lee", { text: "Profile", hyperlink: "https://www.linkedin.com/in/ann" }, "met at a fair"]);
    ws.addRow(["Bo Chan"]);
    ws.addRow(["Cy Diaz", "https://ca.linkedin.com/in/cy", "typed, not linked"]);
    const t = await importers.readTable("people.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(t.headers).toEqual(["Name", "LinkedIn", "Notes", "LinkedIn (link)"]);
    expect(t.rows).toEqual([
      { Name: "Ann Lee", LinkedIn: "Profile", Notes: "met at a fair", "LinkedIn (link)": "https://www.linkedin.com/in/ann" },
      { Name: "Bo Chan", LinkedIn: "", Notes: "", "LinkedIn (link)": "" },
      { Name: "Cy Diaz", LinkedIn: "https://ca.linkedin.com/in/cy", Notes: "typed, not linked", "LinkedIn (link)": "https://ca.linkedin.com/in/cy" },
    ]);
  });

  it("keeps columns mapped to custom field under their header under their header", async () => {
    const rows = [{ Name: "Ann Lee", Function: "Private Equity", Level: "", Source: "LinkedIn" }];
    await importers.importRows(rows, { Name: "name", Function: "custom_field", Level: "custom_field", Source: "source" }, "import");
    const [c] = await data.listContacts({ q: "Ann Lee" });
    expect(c.attributes).toEqual({ Function: "Private Equity", source: "LinkedIn" });
  });

  it("fills an empty company industry from the sheet, never overwriting one", async () => {
    const map = { Name: "name", Company: "company", Industry: "industry" };
    await importers.importRows([{ Name: "Ann Lee", Company: "Evercore", Industry: "Investment Banking" }], map, "import");
    await importers.importRows([{ Name: "Bo Chan", Company: "evercore", Industry: "Asset Management" }], map, "import");
    const [co] = await db.select().from(schema.companies);
    expect([co.name, co.industry]).toEqual(["Evercore", "Investment Banking"]);
  });

  it("keeps a sheet's own Source column as a custom field, out of notes", async () => {
    const rows = [{ Name: "Ann Lee", Source: "PitchBook" }];
    expect((await importers.importRows(rows, { Name: "name", Source: "source" }, "import")).added).toBe(1);
    const [c] = await data.listContacts({ q: "Ann Lee" });
    expect([c.attributes, c.notes, c.source]).toEqual([{ source: "PitchBook" }, "", "import"]);
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
    expect(safeUrl("linkedin.com/in/x")).toBe("https://linkedin.com/in/x");
    expect(safeUrl("www.linkedin.com/in/x")).toBe("https://www.linkedin.com/in/x");
    expect(safeUrl("not a url")).toBe("#");
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

describe("drafts", () => {
  it("deleting the only draft puts the contact back where it was", async () => {
    const cid = (await data.addContact("Ann Lee", "paste", "Figma"))!;
    const first = await data.recordDraft(cid, "initial", "Hi", "Body");
    await data.deleteDraft(first);
    expect((await data.getContact(cid))!.status).toBe("to_contact");

    const { cid: sentId } = await sentContact();
    const nudge = await data.recordDraft(sentId, "followup", "Re: Hi", "Nudge");
    expect((await data.getContact(sentId))!.status).toBe("drafted");
    await data.deleteDraft(nudge);
    const c = (await data.getContact(sentId))!;
    expect([c.status, c.nextFollowupDate]).toEqual(["sent", "2026-10-06"]);
  });

  it("never edits or deletes a sent message", async () => {
    const { mid } = await sentContact();
    await data.updateDraft(mid, "Changed", "Changed");
    await data.deleteDraft(mid);
    expect((await data.listDrafts())).toHaveLength(0);
    const { rows } = await run(sql`select subject from messages where id = ${mid}`) as unknown as { rows: { subject: string }[] };
    expect(rows[0].subject).toBe("Hi");
  });

  it("parses custom fields into graph-friendly keys", () => {
    expect(data.parseAttributes("City: Toronto\nfav lang : Rust\nbroken line\nempty:")).toEqual({ city: "Toronto", fav_lang: "Rust" });
  });
});

describe("batch jobs", () => {
  beforeEach(() => { process.env.OPENAI_API_KEY = "test"; });

  async function runAll(jobId: number) {
    for (const id of await jobs.pendingItems(jobId)) await jobs.runItem(id);
    return (await jobs.getJob(jobId))!;
  }

  it("drafts one email per contact, skips people who already have a draft, and finishes", async () => {
    const a = (await data.addContact("Ann Lee", "paste", "Figma"))!;
    const b = (await data.addContact("Bob Roe", "paste", "Figma"))!;
    await data.recordDraft(b, "initial", "Existing", "Body");
    openaiReply = '{"subject": "Coffee?", "body": "Hi Ann"}';
    const job = await runAll(await jobs.createJob("draft", "be personable", null, [a, b]));
    expect(job.status).toBe("done");
    expect(job.items.map((i) => [i.name, i.status, i.error])).toEqual([
      ["Ann Lee", "done", null], ["Bob Roe", "failed", "Already has an unsent draft."],
    ]);
    expect(String(openaiCalls[0].input)).toContain("be personable");
    expect((await data.listDrafts()).map((d) => d.m.subject).sort()).toEqual(["Coffee?", "Existing"]);
    expect((await data.getContact(a))!.status).toBe("drafted");
  });

  it("passes the instruction to template slots and keeps fixed text", async () => {
    const a = (await data.addContact("Ann Lee", "paste", "Figma"))!;
    openaiReply = '{"hook": "Loved the Config talk.", "why_company": "Figma is where I want to build."}';
    await runAll(await jobs.createJob("draft", "mention Config", 1, [a]));
    const [d] = await data.listDrafts();
    expect(d.m.subject).toBe("Waterloo student interested in Figma");
    expect(d.m.body).toContain("Loved the Config talk.");
    expect(String(openaiCalls[0].input)).toContain("mention Config");
  });

  it("records AI failures per item and can retry them", async () => {
    const a = (await data.addContact("Ann Lee", "paste", "Figma"))!;
    openaiReply = "not json";
    let job = await runAll(await jobs.createJob("draft", "", null, [a]));
    expect(job.items[0].status).toBe("failed");
    expect(job.status).toBe("done");
    await jobs.retryFailed(job.id);
    openaiReply = '{"subject": "Hi", "body": "Hello"}';
    job = await runAll(job.id);
    expect([job.status, job.items[0].status]).toEqual(["done", "done"]);
  });

  it("does nothing after cancel", async () => {
    const a = (await data.addContact("Ann Lee", "paste", "Figma"))!;
    const id = await jobs.createJob("draft", "", null, [a]);
    await jobs.cancelJob(id);
    expect(await jobs.runItem((await jobs.pendingItems(id))[0])).toEqual({ status: "skipped" });
    expect(openaiCalls).toHaveLength(0);
  });

  it("enrich fills only blank fields, including the company's industry", async () => {
    const a = (await data.addContact("Ann Lee", "paste", "Figma", { school: "UofT" }))!;
    openaiReply = '{"industry": "Design software", "team": "Growth", "school": "Waterloo", "program": "CS", "grad_year": "2021"}';
    await runAll(await jobs.createJob("enrich", "", null, [a]));
    const c = (await data.getContact(a))!;
    expect([c.school, c.team, c.program, c.gradYear]).toEqual(["UofT", "Growth", "CS", 2021]);
    const { rows } = await run(sql`select industry from companies where name = 'Figma'`) as unknown as { rows: { industry: string }[] };
    expect(rows[0].industry).toBe("Design software");
  });

  it("refuses an empty selection", async () => {
    await expect(jobs.createJob("draft", "", null, [])).rejects.toThrow("Pick at least one");
  });
});

describe("network graph", () => {
  const person = (id: number, name: string, extra: Partial<GraphContact> = {}): GraphContact => ({
    id, name, title: "", team: "", school: "", program: "", gradYear: null, status: "to_contact", source: "paste",
    howConnected: "", attributes: {}, company: null, industry: null, ...extra,
  });
  const people = [
    person(1, "Ann", { industry: "Fintech", company: "Stripe", attributes: { city: "Toronto" } }),
    person(2, "Bob", { industry: "Fintech", company: "Stripe" }),
    person(3, "Cy", { industry: "Fintech", company: "Wise" }),
    person(4, "Di", { company: "Figma" }),
  ];

  it("groups by levels in order, biggest first, Unknown last, with counts", () => {
    const t = buildTree(people, ["industry", "company"], "Sean");
    expect(t.name).toBe("Sean");
    expect(t.children!.map((c) => [c.name, c.count])).toEqual([["Fintech", 3], ["Unknown", 1]]);
    expect(t.children![0].children!.map((c) => [c.name, c.count])).toEqual([["Stripe", 2], ["Wise", 1]]);
    expect(t.children![0].children![0].children).toEqual([{ name: "Ann", count: 1, contactId: 1 }, { name: "Bob", count: 1, contactId: 2 }]);
  });

  it("reorders levels and groups by custom attributes", () => {
    const t = buildTree(people, ["attr:city", "industry"]);
    expect(t.children!.map((c) => [c.name, c.count])).toEqual([["Toronto", 1], ["Unknown", 3]]); // Unknown last even when bigger
    expect(t.children![0].children![0].name).toBe("Fintech");
  });

  it("keeps only known levels from the URL, defaulting when none are left", () => {
    expect(parseLevels("school,attr:city,bogus,school", ["city"])).toEqual(["school", "attr:city"]);
    expect(parseLevels("bogus", [])).toEqual(["industry", "company"]);
    expect(parseLevels(undefined, [])).toEqual(["industry", "company"]);
  });
});
