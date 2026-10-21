// Batch AI jobs: one job, one item per contact. The browser asks for items one at a time (a few in parallel),
// so each server call drafts or enriches a single contact and stays far under the function time limit.
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, contacts, emailTemplates, jobItems, jobs, messages } from "@/db/schema";
import * as ai from "./ai";
import { getContact, getProfile, recordDraft } from "./data";

export type JobKind = "draft" | "enrich";

export async function createJob(kind: JobKind, instruction: string, templateId: number | null, contactIds: number[]) {
  if (!contactIds.length) throw new Error("Pick at least one contact.");
  const [job] = await db.insert(jobs).values({ kind, instruction, templateId }).returning({ id: jobs.id });
  await db.insert(jobItems).values(contactIds.map((contactId) => ({ jobId: job.id, contactId })));
  return job.id;
}

export async function getJob(id: number) {
  const [job] = await db.select({ j: jobs, template: emailTemplates.name }).from(jobs)
    .leftJoin(emailTemplates, eq(emailTemplates.id, jobs.templateId)).where(eq(jobs.id, id));
  if (!job) return null;
  const items = await db.select({ i: jobItems, name: contacts.name }).from(jobItems)
    .innerJoin(contacts, eq(contacts.id, jobItems.contactId)).where(eq(jobItems.jobId, id)).orderBy(asc(jobItems.id));
  return { ...job.j, template: job.template, items: items.map((r) => ({ ...r.i, name: r.name })) };
}

export async function listJobs() {
  const rows = await db.select({
    j: jobs,
    total: count(jobItems.id),
    done: sql<number>`count(*) filter (where ${jobItems.status} = 'done')`.mapWith(Number),
    failed: sql<number>`count(*) filter (where ${jobItems.status} = 'failed')`.mapWith(Number),
  }).from(jobs).leftJoin(jobItems, eq(jobItems.jobId, jobs.id)).groupBy(jobs.id).orderBy(desc(jobs.id)).limit(20);
  return rows.map((r) => ({ ...r.j, total: r.total, done: r.done, failed: r.failed }));
}

export async function cancelJob(id: number) {
  await db.update(jobs).set({ status: "cancelled" }).where(and(eq(jobs.id, id), eq(jobs.status, "running")));
}

/** Put failed items back in the queue and reopen the job. */
export async function retryFailed(id: number) {
  await db.update(jobItems).set({ status: "pending", error: null }).where(and(eq(jobItems.jobId, id), eq(jobItems.status, "failed")));
  await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, id));
}

async function finishIfDone(jobId: number) {
  const [left] = await db.select({ n: count() }).from(jobItems)
    .where(and(eq(jobItems.jobId, jobId), eq(jobItems.status, "pending")));
  if (!left.n) await db.update(jobs).set({ status: "done" }).where(and(eq(jobs.id, jobId), eq(jobs.status, "running")));
}

/** Process one pending item. Any failure is stored on the item so the rest of the batch keeps going. */
export async function runItem(itemId: number): Promise<{ status: "done" | "failed" | "skipped"; error?: string }> {
  const [row] = await db.select({ i: jobItems, j: jobs }).from(jobItems)
    .innerJoin(jobs, eq(jobs.id, jobItems.jobId)).where(eq(jobItems.id, itemId));
  if (!row || row.i.status !== "pending" || row.j.status !== "running") return { status: "skipped" };
  let result: { status: "done" | "failed"; error?: string; messageId?: number | null };
  try {
    result = row.j.kind === "draft" ? await draftItem(row.j, row.i.contactId) : await enrichItem(row.i.contactId);
  } catch (e) {
    result = { status: "failed", error: (e as Error).message };
  }
  await db.update(jobItems).set({ status: result.status, error: result.error ?? null, messageId: result.messageId ?? null })
    .where(eq(jobItems.id, itemId));
  await finishIfDone(row.j.id);
  return { status: result.status, error: result.error };
}

async function draftItem(job: typeof jobs.$inferSelect, contactId: number) {
  const c = await getContact(contactId);
  if (!c) return { status: "failed" as const, error: "Contact was deleted." };
  const prior = await db.select().from(messages).where(eq(messages.contactId, contactId)).orderBy(asc(messages.id));
  // ponytail: also stops a second open tab from drafting the same person twice in most cases; a claim column if it ever matters.
  if (prior.some((m) => !m.sentAt)) return { status: "failed" as const, error: "Already has an unsent draft." };
  const [co] = c.companyId ? await db.select().from(companies).where(eq(companies.id, c.companyId)) : [];
  const profile = await getProfile();
  const [tpl] = job.templateId ? await db.select().from(emailTemplates).where(eq(emailTemplates.id, job.templateId)) : [];
  const { subject, body } = tpl
    ? await ai.draft(tpl, profile, c, co ?? null, prior, job.instruction)
    : await ai.freeDraft(job.instruction, profile, c, co ?? null, prior);
  const kind = tpl?.kind ?? (prior.some((m) => m.sentAt) ? "followup" : "initial");
  return { status: "done" as const, messageId: await recordDraft(contactId, kind, subject, body) };
}

async function enrichItem(contactId: number) {
  const c = await getContact(contactId);
  if (!c) return { status: "failed" as const, error: "Contact was deleted." };
  const [co] = c.companyId ? await db.select().from(companies).where(eq(companies.id, c.companyId)) : [];
  const e = await ai.enrich(c);
  const year = Number.parseInt(e.grad_year, 10);
  // Only fill blanks; never overwrite what the user typed.
  await db.update(contacts).set({
    team: c.team || e.team, school: c.school || e.school, program: c.program || e.program,
    gradYear: c.gradYear ?? (Number.isFinite(year) ? year : null),
  }).where(eq(contacts.id, contactId));
  if (co && !co.industry && e.industry) {
    await db.update(companies).set({ industry: e.industry }).where(and(eq(companies.id, co.id), eq(companies.industry, "")));
  }
  return { status: "done" as const };
}

/** Pending item ids, for the browser's runner. */
export async function pendingItems(jobId: number) {
  const rows = await db.select({ id: jobItems.id }).from(jobItems)
    .where(and(eq(jobItems.jobId, jobId), eq(jobItems.status, "pending"))).orderBy(asc(jobItems.id));
  return rows.map((r) => r.id);
}
