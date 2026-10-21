// Email template filling (no AI): {placeholders} come from data, [[slot: instruction]] markers are written by AI.
const PLACEHOLDER = /\{(\w+)\}/g;
const SLOT = /\[\[(\w+):\s*([\s\S]*?)\]\]/g;

export class AIError extends Error {}

/** Replace {name} placeholders that have a value; leave the rest visible. */
export function fillData(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (m, k: string) => values[k] || m);
}

export function extractSlots(text: string): Record<string, string> {
  return Object.fromEntries([...text.matchAll(SLOT)].map((m) => [m[1], m[2].trim()]));
}

/** Swap each [[slot: ...]] for its AI text; a missing or empty slot stays as a visible marker. */
export function applySlots(text: string, filled: Record<string, string>): string {
  return text.replace(SLOT, (m, k: string) => (filled[k] ?? "").trim() || m);
}

export function unfilled(text: string): string[] {
  return [...[...text.matchAll(PLACEHOLDER)].map((m) => m[0]), ...[...text.matchAll(SLOT)].map((m) => m[0])];
}

export function parseJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new AIError("The AI did not return JSON.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new AIError(`The AI returned invalid JSON: ${(e as Error).message}`);
  }
}

export type Profile = {
  name: string; program: string; resumeText: string; story: string;
  targetRoles: string; voiceSamples: string; followupDays: number;
};

export function dataValues(profile: Profile, contact: { name: string; company: string | null; title: string }) {
  const parts = contact.name.split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] ?? "",
    last_name: parts.length > 1 ? parts[parts.length - 1] : "",
    company: contact.company ?? "",
    title: contact.title,
    my_name: profile.name,
    my_program: profile.program,
    target_role: profile.targetRoles.split(/[,\n]/)[0].trim(),
  };
}
