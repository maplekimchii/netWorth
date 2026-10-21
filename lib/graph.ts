// Network graph: a tree built on request from contacts. Root is "me"; each level groups by one field; leaves are people.
import { label } from "./format";

export const BUILTIN_LEVELS = [
  "industry", "company", "team", "title", "school", "program", "grad_year", "status", "source", "how_connected",
] as const;
export const DEFAULT_LEVELS = ["industry", "company"];
export const UNKNOWN = "Unknown";

export type GraphContact = {
  id: number; name: string; title: string; team: string; school: string; program: string; gradYear: number | null;
  status: string; source: string; howConnected: string; attributes: Record<string, string>;
  company: string | null; industry: string | null;
};

export type TreeNode = { name: string; count: number; contactId?: number; children?: TreeNode[] };

/** Levels are built-in field names or custom attribute keys written as "attr:<key>". */
export function levelLabel(level: string) {
  return label(level.replace(/^attr:/, ""));
}

function value(c: GraphContact, level: string): string {
  const v: Record<string, unknown> = {
    industry: c.industry, company: c.company, team: c.team, title: c.title, school: c.school, program: c.program,
    grad_year: c.gradYear, status: c.status && label(c.status), source: c.source && label(c.source), how_connected: c.howConnected,
  };
  const raw = level in v ? v[level] : c.attributes[level.replace(/^attr:/, "")];
  const s = raw == null ? "" : String(raw).trim();
  return s || UNKNOWN;
}

/** Group contacts into nested levels. Bigger groups first; "Unknown" always last. */
export function buildTree(contacts: GraphContact[], levels: string[], rootName = "Me"): TreeNode {
  const group = (rows: GraphContact[], depth: number): TreeNode[] => {
    if (depth === levels.length) {
      return rows.map((c) => ({ name: c.name, count: 1, contactId: c.id })).sort((a, b) => a.name.localeCompare(b.name));
    }
    const buckets = new Map<string, GraphContact[]>();
    for (const c of rows) {
      const k = value(c, levels[depth]);
      buckets.set(k, [...(buckets.get(k) ?? []), c]);
    }
    return [...buckets].map(([name, rs]) => ({ name, count: rs.length, children: group(rs, depth + 1) }))
      .sort((a, b) => (a.name === UNKNOWN ? 1 : 0) - (b.name === UNKNOWN ? 1 : 0) || b.count - a.count || a.name.localeCompare(b.name));
  };
  return { name: rootName, count: contacts.length, children: group(contacts, 0) };
}

/** Parse ?levels=industry,company into known levels only. */
export function parseLevels(raw: string | undefined, attributeKeys: string[]): string[] {
  const known = new Set<string>([...BUILTIN_LEVELS, ...attributeKeys.map((k) => `attr:${k}`)]);
  const levels = (raw ?? "").split(",").map((s) => s.trim()).filter((s) => known.has(s));
  return levels.length ? [...new Set(levels)] : DEFAULT_LEVELS;
}
