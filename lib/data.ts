// Storage rules for netWorth: duplicates, status transitions, follow-up dates. Port of v1 db.py.
import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  applications, companies, contactSource, contactStatus, appStatus, contacts, messages, profile,
} from "@/db/schema";
import { addDays, today, TZ } from "./format";
import type { Profile } from "./templating";

export const STATUSES = contactStatus.enumValues;
export const APP_STATUSES = appStatus.enumValues;
export const SOURCES = contactSource.enumValues;
export type Status = (typeof STATUSES)[number];
export type Source = (typeof SOURCES)[number];
export type AppStatus = (typeof APP_STATUSES)[number];
// Automation (drafting, marking sent/replied) may only move contacts that are in one of these states.
const OPEN: Status[] = ["to_contact", "drafted", "sent"];

export const cleanName = (name: string | null | undefined) => (name ?? "").split(/\s+/).filter(Boolean).join(" ");
const localDate = (col: SQL | typeof messages.createdAt) => sql`(${col} at time zone ${TZ})::date`;

export async function getOrCreateCompany(name: string | null | undefined): Promise<number | null> {
  const n = cleanName(name);
  if (!n) return null;
  const find = () => db.select({ id: companies.id }).from(companies).where(sql`lower(${companies.name}) = lower(${n})`);
  const [row] = await find();
  if (row) return row.id;
  await db.insert(companies).values({ name: n }).onConflictDoNothing();
  return (await find())[0].id;
}

async function companyIdIfExists(name: string): Promise<number | null | undefined> {
  const n = cleanName(name);
  if (!n) return null;
  const [row] = await db.select({ id: companies.id }).from(companies).where(sql`lower(${companies.name}) = lower(${n})`);
  return row?.id; // undefined: company unknown, so no contact there can be a duplicate
}

async function isDup(name: string, companyId: number | null) {
  const rows = await db.select({ id: contacts.id }).from(contacts).where(and(
    sql`lower(${contacts.name}) = lower(${cleanName(name)})`,
    sql`${contacts.companyId} is not distinct from ${companyId}`,
  ));
  return rows.length > 0;
}

/** Same duplicate rule as addContact, without creating the company. */
export async function contactExists(name: string, company = "") {
  const coid = await companyIdIfExists(company);
  return coid !== undefined && isDup(name, coid);
}

export const CONTACT_TEXT_FIELDS = [
  "title", "email", "linkedinUrl", "howConnected", "notes", "team", "school", "program",
] as const;
export type ContactFields = Partial<Record<(typeof CONTACT_TEXT_FIELDS)[number], string>> & { gradYear?: string };

function contactValues(f: ContactFields) {
  const year = Number.parseInt(f.gradYear ?? "", 10);
  return {
    ...Object.fromEntries(CONTACT_TEXT_FIELDS.map((k) => [k, (f[k] ?? "").trim()])),
    gradYear: Number.isFinite(year) ? year : null,
  } as Record<(typeof CONTACT_TEXT_FIELDS)[number], string> & { gradYear: number | null };
}

/** Returns the new id, or null when the same person at the same company is already saved. */
export async function addContact(name: string, source: Source, company = "", fields: ContactFields = {}) {
  const n = cleanName(name);
  if (!n) throw new Error("A contact needs a name.");
  const companyId = await getOrCreateCompany(company);
  if (await isDup(n, companyId)) return null;
  const [row] = await db.insert(contacts)
    .values({ name: n, source, companyId, ...contactValues(fields) }).returning({ id: contacts.id });
  return row.id;
}

export async function updateContact(id: number, name: string, company: string, fields: ContactFields) {
  await db.update(contacts)
    .set({ name: cleanName(name), companyId: await getOrCreateCompany(company), ...contactValues(fields) })
    .where(eq(contacts.id, id));
}

export async function getContact(id: number) {
  const [row] = await db.select({ c: contacts, company: companies.name }).from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId)).where(eq(contacts.id, id));
  return row ? { ...row.c, company: row.company } : null;
}

export async function listContacts(f: { status?: string; companyId?: number; source?: string; q?: string } = {}) {
  const where: SQL[] = [];
  const q = f.q?.trim();
  if (q) where.push(or(ilike(contacts.name, `%${q}%`), ilike(contacts.title, `%${q}%`), ilike(companies.name, `%${q}%`))!);
  if (f.status && (STATUSES as readonly string[]).includes(f.status)) where.push(eq(contacts.status, f.status as Status));
  if (f.companyId) where.push(eq(contacts.companyId, f.companyId));
  if (f.source && (SOURCES as readonly string[]).includes(f.source)) where.push(eq(contacts.source, f.source as Source));
  const rows = await db.select({ c: contacts, company: companies.name }).from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId)).where(and(...where))
    .orderBy(desc(contacts.createdAt), desc(contacts.id));
  return rows.map((r) => ({ ...r.c, company: r.company }));
}

export async function getProfile(): Promise<Profile> {
  const [p] = await db.select().from(profile).where(eq(profile.id, 1));
  return p;
}

async function followupDue(sentDate: string) {
  return addDays(sentDate, (await getProfile()).followupDays);
}

/** Manual status change. Only 'sent' keeps a follow-up date; every other status clears it. */
export async function setStatus(id: number, status: string) {
  if (!(STATUSES as readonly string[]).includes(status)) throw new Error(`Unknown status: ${status}`);
  const next = status === "sent" ? await followupDue(today()) : null;
  await db.update(contacts).set({ status: status as Status, nextFollowupDate: next }).where(eq(contacts.id, id));
}

export async function recordDraft(contactId: number, kind: "initial" | "followup", subject: string, body: string) {
  const [m] = await db.insert(messages).values({ contactId, kind, subject, body }).returning({ id: messages.id });
  await db.update(contacts).set({ status: "drafted" })
    .where(and(eq(contacts.id, contactId), inArray(contacts.status, ["to_contact", "sent"])));
  return m.id;
}

export async function updateDraft(messageId: number, subject: string, body: string) {
  await db.update(messages).set({ subject, body }).where(and(eq(messages.id, messageId), isNull(messages.sentAt)));
}

export async function markSent(messageId: number, sentAt = new Date()) {
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!m || m.sentAt) return;
  await db.update(messages).set({ sentAt }).where(eq(messages.id, messageId));
  await db.update(contacts).set({
    status: "sent",
    nextFollowupDate: await followupDue(today(sentAt)),
    followupCount: sql`${contacts.followupCount} + ${m.kind === "followup" ? 1 : 0}`,
  }).where(and(eq(contacts.id, m.contactId), inArray(contacts.status, OPEN)));
}

export async function markReplied(messageId: number, repliedAt = new Date()) {
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!m || m.repliedAt) return;
  await db.update(messages).set({ repliedAt, sentAt: m.sentAt ?? repliedAt }).where(eq(messages.id, messageId));
  await db.update(contacts).set({ status: "replied", nextFollowupDate: null })
    .where(and(eq(contacts.id, m.contactId), inArray(contacts.status, OPEN)));
}

export async function addApplication(company: string, role: string, url = "", referrerContactId: number | null = null) {
  const companyId = await getOrCreateCompany(company);
  if (companyId === null || !role.trim()) throw new Error("An application needs a company and a role.");
  await db.insert(applications).values({ companyId, role: role.trim(), url, referrerContactId });
}

export async function updateApplication(id: number, status: string, referrerContactId: number | null) {
  if (!(APP_STATUSES as readonly string[]).includes(status)) throw new Error(`Unknown application status: ${status}`);
  // Right-hand sides see the old row, so updated_at only moves when the status really changes.
  await db.update(applications).set({
    updatedAt: sql`case when ${applications.status} != ${status} then now() else ${applications.updatedAt} end`,
    appliedDate: sql`case when ${status} = 'applied' and ${applications.appliedDate} is null then ${today()}::date else ${applications.appliedDate} end`,
    status: status as AppStatus,
    referrerContactId,
  }).where(eq(applications.id, id));
}

export async function todayView(day = today()) {
  const due = await db.select({
    c: contacts, company: companies.name,
    daysLate: sql<number>`(${day}::date - ${contacts.nextFollowupDate})`.mapWith(Number),
  }).from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(and(eq(contacts.status, "sent"), sql`${contacts.nextFollowupDate} <= ${day}::date`))
    .orderBy(contacts.nextFollowupDate);
  const unsent = await db.select({
    id: messages.id, subject: messages.subject, createdAt: messages.createdAt, contactId: contacts.id, name: contacts.name,
  }).from(messages).innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(and(isNull(messages.sentAt), eq(contacts.status, "drafted"),
      sql`${localDate(messages.createdAt)} <= ${addDays(day, -2)}::date`))
    .orderBy(messages.createdAt);
  const staleApps = await db.select({ a: applications, company: companies.name }).from(applications)
    .innerJoin(companies, eq(companies.id, applications.companyId))
    .where(and(inArray(applications.status, ["planned", "applied", "interview"]),
      sql`${localDate(sql`${applications.updatedAt}`)} <= ${addDays(day, -14)}::date`))
    .orderBy(applications.updatedAt);
  return {
    due: due.map((r) => ({ ...r.c, company: r.company, daysLate: r.daysLate })),
    unsent,
    staleApps: staleApps.map((r) => ({ ...r.a, company: r.company })),
  };
}

export async function dueCount(day = today()) {
  const [r] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(contacts)
    .where(and(eq(contacts.status, "sent"), sql`${contacts.nextFollowupDate} <= ${day}::date`));
  return r.n;
}

/** Numbers for the Today tiles. replyRate is a whole percent over the last 30 days, or null with no sends. */
export async function stats(day = today()) {
  const sentDate = localDate(sql`${messages.sentAt}`);
  const [m] = await db.select({
    sent30: sql<number>`count(*) filter (where ${sentDate} >= ${addDays(day, -29)}::date)`.mapWith(Number),
    replied30: sql<number>`count(${messages.repliedAt}) filter (where ${sentDate} >= ${addDays(day, -29)}::date)`.mapWith(Number),
    sentWeek: sql<number>`count(*) filter (where ${sentDate} >= ${addDays(day, -6)}::date)`.mapWith(Number),
  }).from(messages);
  const [c] = await db.select({ calls: sql<number>`count(*)`.mapWith(Number) }).from(contacts).where(eq(contacts.status, "call"));
  return {
    due: await dueCount(day),
    sentWeek: m.sentWeek,
    replyRate: m.sent30 ? Math.round((100 * m.replied30) / m.sent30) : null,
    calls: c.calls,
  };
}
