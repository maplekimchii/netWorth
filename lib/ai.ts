// OpenAI calls (Responses API). Port of v1 ai.py; prompts unchanged.
import OpenAI from "openai";
import {
  AIError, applySlots, dataValues, extractSlots, fillData, parseJson, type Profile,
} from "./templating";

const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";

let client: OpenAI | undefined;
function openai() {
  if (!process.env.OPENAI_API_KEY) throw new AIError("No OpenAI API key found. Set OPENAI_API_KEY in Vercel.");
  return (client ??= new OpenAI());
}

async function call(instructions: string, input: string, search = false): Promise<string> {
  const r = await openai().responses.create({
    model: MODEL, instructions, input, ...(search ? { tools: [{ type: "web_search" as const }] } : {}),
  });
  return r.output_text ?? "";
}

/** Ask the model for a JSON object; retry once if the reply is not valid JSON. */
async function askJson(system: string, prompt: string, search = false) {
  try {
    return parseJson(await call(system, prompt, search));
  } catch (e) {
    if (!(e instanceof AIError)) throw e;
    return parseJson(await call(system, prompt, search));
  }
}

const str = (v: unknown) => (v == null ? "" : String(v));

function me(p: Profile) {
  return `Me: ${p.name}, ${p.program}. Target roles: ${p.targetRoles}.\nMy story: ${p.story}`;
}

const FIND_SYSTEM = "You help a student find people to contact for job-search networking. Use web search. "
  + "List only real people you found evidence for in the search results who currently work at the "
  + "company. Never invent names, titles, or URLs.";

export type FoundPerson = { name: string; title: string; why_relevant: string; source_url: string; linkedin_url: string };

export async function findPeople(company: string, focus: string, profile: Profile): Promise<FoundPerson[]> {
  const data = await askJson(FIND_SYSTEM, `${me(profile)}

Find up to 8 people currently at ${company} worth contacting. Focus: ${focus || "anyone relevant to my target roles"}.
Prefer people likely to reply to a student: alumni of my school, recruiters, hiring managers, and people on teams that match my target roles.

Reply with only a JSON object:
{"people": [{"name": "", "title": "", "why_relevant": "one sentence", "source_url": "", "linkedin_url": "or empty"}]}`, true);
  const people = Array.isArray(data.people) ? (data.people as Record<string, unknown>[]) : [];
  return people.filter((p) => str(p.name)).map((p) => ({
    name: str(p.name), title: str(p.title), why_relevant: str(p.why_relevant),
    source_url: str(p.source_url), linkedin_url: str(p.linkedin_url),
  }));
}

export const PARSED_FIELDS = [
  "name", "company", "title", "email", "linkedin_url", "notes", "team", "school", "program", "grad_year",
] as const;
export type Parsed = Record<(typeof PARSED_FIELDS)[number], string>;

export async function parseProfile(text: string): Promise<Parsed> {
  const data = await askJson("You extract contact details from pasted profile text. Use only what the text says; "
    + "leave a field empty when the text does not contain it.", `<profile>
${text}
</profile>

Reply with only a JSON object:
{"name": "", "company": "current employer", "title": "current title", "email": "", "linkedin_url": "", "notes": "1-2 lines useful for a personal hook: schools, past companies, notable work", "team": "current team if stated", "school": "most recent school", "program": "program or degree at that school", "grad_year": "4-digit graduation year or empty"}`);
  return Object.fromEntries(PARSED_FIELDS.map((k) => [k, str(data[k])])) as Parsed;
}

export async function researchCompany(name: string): Promise<string> {
  const data = await askJson("You research companies for a job seeker. Use web search. Prefer news from the last six "
    + "months and include only facts you found.",
  `Research ${name}: recent launches, funding, leadership changes, and hiring signals.\n`
    + 'Reply with only a JSON object: {"bullets": ["3 to 5 short bullets, each ending with (Month Year)"]}', true);
  const bullets = Array.isArray(data.bullets) ? data.bullets : [];
  return bullets.map((b) => `- ${str(b)}`).join("\n");
}

const SLOT_SYSTEM = "You write short passages for the user's networking emails, in the user's own voice. Match the tone, "
  + "sentence length, and word choice of the voice samples. Sound like a real person writing one email, "
  + "not marketing copy: be specific, skip flattery and filler, and never invent facts that are not in "
  + "the context.";

async function fillSlots(slots: Record<string, string>, context: string, voiceSamples: string, extra: string) {
  const spec = Object.entries(slots).map(([k, v]) => `- "${k}": ${v}`).join("\n");
  const data = await askJson(SLOT_SYSTEM, `${context}

<voice_samples>
${voiceSamples || "(none provided: write plainly and warmly)"}
</voice_samples>
${extra ? `\nExtra instruction from me for this email: ${extra}\n` : ""}
Write the text for each slot below. Each slot is dropped into a fixed email template, so write only the slot text: no greeting, no sign-off.
${spec}

Reply with only a JSON object mapping each slot name to its text.`);
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, str(v)]));
}

export type DraftContact = {
  name: string; title: string; company: string | null; howConnected: string; notes: string;
};
export type DraftCompany = { name: string; notes: string; news: string } | null;
export type PriorMessage = { subject: string; body: string; sentAt: Date | null };

function context(p: Profile, c: DraftContact, co: DraftCompany, prior: PriorMessage[]) {
  const lines = [me(p), `My resume:\n${p.resumeText}`, "",
    `Contact: ${c.name}, ${c.title || "title unknown"} at ${c.company || "unknown company"}`,
    `How we're connected: ${c.howConnected || "not connected"}`,
    `Notes on them: ${c.notes || "none"}`];
  if (co) lines.push(`Why I'm interested in ${co.name}: ${co.notes || "none"}`, `Recent news:\n${co.news || "none"}`);
  for (const m of prior) {
    lines.push(`Earlier email I ${m.sentAt ? "sent" : "drafted"} (subject: ${m.subject}):\n${m.body}`);
  }
  return lines.join("\n");
}

/** Write a whole email from a one-off instruction, for batch jobs run without a template. */
export async function freeDraft(
  instruction: string, profile: Profile, contact: DraftContact, company: DraftCompany, prior: PriorMessage[],
): Promise<{ subject: string; body: string }> {
  const data = await askJson(SLOT_SYSTEM, `${context(profile, contact, company, prior)}

<voice_samples>
${profile.voiceSamples || "(none provided: write plainly and warmly)"}
</voice_samples>

Write one networking email from me to ${contact.name}. Instruction: ${instruction || "a short, personable note asking for a 15-minute chat"}
Keep it under 150 words, sign it with my name, and use only facts from the context.

Reply with only a JSON object: {"subject": "", "body": ""}`);
  return { subject: str(data.subject), body: str(data.body) };
}

export const ENRICH_FIELDS = ["industry", "team", "school", "program", "grad_year"] as const;
export type Enriched = Record<(typeof ENRICH_FIELDS)[number], string>;

/** Infer graph fields from what we already know about a contact. Empty when the text does not say. */
export async function enrich(contact: DraftContact & { team: string; school: string; program: string }): Promise<Enriched> {
  const data = await askJson("You fill in missing CRM fields from the text given. Use only what the text says or "
    + "what is common knowledge about the company (for industry). Leave a field empty when unsure.", `Contact: ${contact.name}
Title: ${contact.title || "unknown"}
Company: ${contact.company || "unknown"}
Team: ${contact.team || "unknown"}
School: ${contact.school || "unknown"}, program: ${contact.program || "unknown"}
How we're connected: ${contact.howConnected || "unknown"}
Notes: ${contact.notes || "none"}

Reply with only a JSON object:
{"industry": "the company's industry in 1-3 words", "team": "", "school": "", "program": "", "grad_year": "4-digit year or empty"}`);
  return Object.fromEntries(ENRICH_FIELDS.map((k) => [k, str(data[k])])) as Enriched;
}

/** Fill a template for one contact. `extra` is an optional one-off instruction (used by batch jobs). */
export async function draft(
  template: { subject: string; body: string }, profile: Profile, contact: DraftContact,
  company: DraftCompany, prior: PriorMessage[], extra = "",
): Promise<{ subject: string; body: string }> {
  const values = dataValues(profile, contact);
  let subject = fillData(template.subject, values), body = fillData(template.body, values);
  const slots = extractSlots(`${subject}\n${body}`);
  if (Object.keys(slots).length) {
    const filled = await fillSlots(slots, context(profile, contact, company, prior), profile.voiceSamples, extra);
    subject = applySlots(subject, filled);
    body = applySlots(body, filled);
  }
  return { subject, body };
}
