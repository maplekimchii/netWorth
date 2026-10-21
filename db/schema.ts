// Postgres port of the Flask app's SQLite schema (db.py), plus the v2 tables.
import { sql } from "drizzle-orm";
import {
  check, date, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

export const contactStatus = pgEnum("contact_status",
  ["to_contact", "drafted", "sent", "replied", "call", "done", "dead"]);
export const contactSource = pgEnum("contact_source", ["linkedin_csv", "ai_search", "paste", "import"]);
export const appStatus = pgEnum("app_status", ["planned", "applied", "interview", "offer", "rejected"]);
export const messageKind = pgEnum("message_kind", ["initial", "followup"]);
export const jobKind = pgEnum("job_kind", ["draft", "enrich"]);
export const jobStatus = pgEnum("job_status", ["running", "done", "cancelled"]);
export const jobItemStatus = pgEnum("job_item_status", ["pending", "done", "failed"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const profile = pgTable("profile", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default(""),
  program: text("program").notNull().default(""),
  resumeText: text("resume_text").notNull().default(""),
  story: text("story").notNull().default(""),
  targetRoles: text("target_roles").notNull().default(""),
  voiceSamples: text("voice_samples").notNull().default(""),
  followupDays: integer("followup_days").notNull().default(5),
}, (t) => [check("profile_single_row", sql`${t.id} = 1`)]);

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull().default(""),
  industry: text("industry").notNull().default(""),
  priority: integer("priority").notNull().default(2),
  notes: text("notes").notNull().default(""),
  news: text("news").notNull().default(""),
  newsUpdatedAt: timestamp("news_updated_at", { withTimezone: true }),
}, (t) => [uniqueIndex("companies_name_ci").on(sql`lower(${t.name})`)]);

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  companyId: integer("company_id").references(() => companies.id),
  title: text("title").notNull().default(""),
  email: text("email").notNull().default(""),
  linkedinUrl: text("linkedin_url").notNull().default(""),
  source: contactSource("source").notNull(),
  howConnected: text("how_connected").notNull().default(""),
  status: contactStatus("status").notNull().default("to_contact"),
  notes: text("notes").notNull().default(""),
  nextFollowupDate: date("next_followup_date"),
  followupCount: integer("followup_count").notNull().default(0),
  // Network graph fields; `attributes` holds user-defined ones like {"city": "Toronto"}.
  team: text("team").notNull().default(""),
  school: text("school").notNull().default(""),
  program: text("program").notNull().default(""),
  gradYear: integer("grad_year"),
  attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
});

export const emailTemplates = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: messageKind("kind").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  kind: messageKind("kind").notNull(),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  createdAt: createdAt(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
});

export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  role: text("role").notNull(),
  url: text("url").notNull().default(""),
  status: appStatus("status").notNull().default("planned"),
  appliedDate: date("applied_date"),
  referrerContactId: integer("referrer_contact_id").references(() => contacts.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const columnMappings = pgTable("column_mappings", {
  signature: text("signature").primaryKey(),
  mapping: jsonb("mapping").$type<Record<string, string>>().notNull(),
});

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  kind: jobKind("kind").notNull().default("draft"),
  instruction: text("instruction").notNull().default(""),
  templateId: integer("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
  status: jobStatus("status").notNull().default("running"),
  createdAt: createdAt(),
});

export const jobItems = pgTable("job_items", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  status: jobItemStatus("status").notNull().default("pending"),
  error: text("error"),
  messageId: integer("message_id").references(() => messages.id, { onDelete: "set null" }),
});

export const graphViews = pgTable("graph_views", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  levels: jsonb("levels").$type<string[]>().notNull(),
});
