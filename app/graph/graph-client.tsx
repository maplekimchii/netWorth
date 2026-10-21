"use client";
import { hierarchy, tree as treeLayout, type HierarchyPointNode } from "d3-hierarchy";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { saveGraphView } from "@/app/actions";
import { BUILTIN_LEVELS, levelLabel, type TreeNode } from "@/lib/graph";

/** Ordered level chips: drag or use the arrows to reorder, × to remove, the select to add. Applies via the URL. */
export function LevelEditor({ levels, attributeKeys }: { levels: string[]; attributeKeys: string[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(levels);
  const dragFrom = useRef<number | null>(null);
  const options = [...BUILTIN_LEVELS, ...attributeKeys.map((k) => `attr:${k}`)].filter((l) => !draft.includes(l));
  const move = (from: number, to: number) => setDraft((d) => {
    if (to < 0 || to >= d.length) return d;
    const n = [...d];
    n.splice(to, 0, n.splice(from, 1)[0]);
    return n;
  });
  const changed = draft.join(",") !== levels.join(",");

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <span className="muted small">Me →</span>
        {draft.map((l, i) => (
          <span key={l} className="pill row" style={{ gap: 4, cursor: "grab" }} draggable
            onDragStart={() => { dragFrom.current = i; }} onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; }}>
            <button type="button" className="btn-ghost" aria-label={`Move ${levelLabel(l)} earlier`} onClick={() => move(i, i - 1)} disabled={i === 0}>‹</button>
            {levelLabel(l)}
            <button type="button" className="btn-ghost" aria-label={`Move ${levelLabel(l)} later`} onClick={() => move(i, i + 1)} disabled={i === draft.length - 1}>›</button>
            <button type="button" className="btn-ghost" aria-label={`Remove ${levelLabel(l)}`} onClick={() => setDraft((d) => d.filter((x) => x !== l))} disabled={draft.length === 1}>×</button>
          </span>
        ))}
        <span className="muted small">→ people</span>
        {options.length > 0 && (
          <select aria-label="Add a level" value="" onChange={(e) => setDraft((d) => [...d, e.target.value])} style={{ width: "auto", height: 28 }}>
            <option value="">+ Add level</option>
            {options.map((o) => <option key={o} value={o}>{levelLabel(o)}</option>)}
          </select>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn btn-sm btn-primary" disabled={!changed}
          onClick={() => router.push(`/graph?levels=${encodeURIComponent(draft.join(","))}`)}>Apply</button>
        <form action={saveGraphView.bind(null, levels)} className="row">
          <input name="name" placeholder="View name" aria-label="View name" style={{ width: 160, height: 28 }} />
          <button className="btn btn-sm" disabled={changed} title={changed ? "Apply first, then save" : undefined}>Save view</button>
        </form>
      </div>
    </div>
  );
}

const ROW = 26, COL = 210;

/** Horizontal collapsible tree. Groups fold on click; people link to their contact page. Drag to pan; buttons zoom. */
export function GraphView({ tree }: { tree: TreeNode }) {
  // Fold everything below the second level at first so big networks stay readable.
  const [folded, setFolded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const walk = (n: TreeNode, path: string, depth: number) => {
      if (n.children && depth >= 2) s.add(path);
      n.children?.forEach((c) => walk(c, `${path}/${c.name}`, depth + 1));
    };
    walk(tree, "", 0);
    return s;
  });
  const [view, setView] = useState({ x: 40, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const { nodes, links, height, top } = useMemo(() => {
    const pathOf = new Map<TreeNode, string>();
    const root = hierarchy(tree, (n) => {
      const p = pathOf.get(n) ?? "";
      n.children?.forEach((c) => pathOf.set(c, `${p}/${c.name}`));
      return folded.has(p) ? null : n.children;
    });
    const laid = treeLayout<TreeNode>().nodeSize([ROW, COL])(root);
    const all = laid.descendants();
    const xs = all.map((n) => n.x);
    const min = Math.min(...xs), max = Math.max(...xs);
    return {
      nodes: all.map((n) => ({ n, path: pathFor(n) })),
      links: laid.links(),
      height: Math.max(240, Math.min(720, max - min + ROW * 2)),
      top: -min + ROW,
    };
  }, [tree, folded]);

  const toggle = (path: string) => setFolded((f) => {
    const n = new Set(f);
    if (!n.delete(path)) n.add(path);
    return n;
  });

  const zoom = (f: number) => setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.3, v.k * f)) }));

  return (
    <div style={{ position: "relative" }}>
    <div className="row" style={{ position: "absolute", top: 8, right: 8 }}>
      <button type="button" className="btn btn-sm" aria-label="Zoom in" onClick={() => zoom(1.25)}>+</button>
      <button type="button" className="btn btn-sm" aria-label="Zoom out" onClick={() => zoom(0.8)}>−</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setView({ x: 40, y: 0, k: 1 })}>Reset</button>
    </div>
    <svg role="img" aria-label="Network graph" width="100%" height={height}
      style={{ display: "block", cursor: "grab", touchAction: "none" }}
      onPointerDown={(e) => { drag.current = { x: e.clientX - view.x, y: e.clientY - view.y }; }}
      onPointerMove={(e) => { const d = drag.current; if (d && e.buttons) setView((v) => ({ ...v, x: e.clientX - d.x, y: e.clientY - d.y })); }}
      onPointerUp={() => { drag.current = null; }}
      onPointerLeave={() => { drag.current = null; }}>
      <g transform={`translate(${view.x},${view.y + top * view.k}) scale(${view.k})`}>
        {links.map((l, i) => (
          <path key={i} fill="none" stroke="var(--line)" strokeWidth={1.5}
            d={`M${l.source.y},${l.source.x}C${(l.source.y + l.target.y) / 2},${l.source.x} ${(l.source.y + l.target.y) / 2},${l.target.x} ${l.target.y},${l.target.x}`} />
        ))}
        {nodes.map(({ n, path }) => {
          const d = n.data;
          const isPerson = d.contactId !== undefined;
          const isFolded = folded.has(path);
          const text = isPerson ? d.name : `${d.name} (${d.count})`;
          const dot = (
            <circle r={isPerson ? 4 : 6} fill={isPerson ? "var(--surface)" : isFolded ? "var(--accent)" : "var(--accent-soft)"}
              stroke="var(--accent)" strokeWidth={1.5} />
          );
          return (
            <g key={isPerson ? `p${d.contactId}` : path || "root"} transform={`translate(${n.y},${n.x})`}>
              {isPerson ? (
                <Link href={`/contacts/${d.contactId}`}>
                  {dot}<text x={8} dy="0.32em" fontSize={12.5} fill="var(--accent-fg)">{text}</text>
                </Link>
              ) : (
                <g role="button" tabIndex={0} aria-expanded={!isFolded} aria-label={`${text}, ${isFolded ? "folded" : "open"}`}
                  style={{ cursor: "pointer" }} onClick={() => n.depth > 0 && toggle(path)}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && n.depth > 0) { e.preventDefault(); toggle(path); } }}>
                  {dot}<text x={10} dy="0.32em" fontSize={13} fontWeight={n.depth === 0 ? 700 : 600} fill="var(--fg)">{text}</text>
                </g>
              )}
            </g>
          );
        })}
      </g>
    </svg>
    </div>
  );
}

function pathFor(n: HierarchyPointNode<TreeNode>): string {
  return n.ancestors().reverse().slice(1).map((a) => `/${a.data.name}`).join("");
}
