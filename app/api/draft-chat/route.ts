// Draft side-panel chat. Streams newline-delimited JSON events so the panel shows steps, thinking, and text live.
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { auth } from "@/auth";
import { db } from "@/db";
import { companies, messages } from "@/db/schema";
import * as ai from "@/lib/ai";
import * as data from "@/lib/data";
import { plural } from "@/lib/format";
import { AIError } from "@/lib/templating";

export type ChatEvent = { type: "step" | "thinking" | "text" | "error"; text: string };

export async function POST(req: Request) {
  if (!(await auth())) return new Response("Sign in first.", { status: 401 });
  const a = await req.json() as { messageId: number; subject: string; body: string; history: ai.ChatTurn[]; request: string };
  const history = (Array.isArray(a.history) ? a.history : [])
    .map((t) => ({ role: t.role === "ai" ? "ai" as const : "me" as const, text: String(t.text) }));

  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(ctl) {
      const send = (e: ChatEvent) => ctl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        const [m] = await db.select().from(messages).where(eq(messages.id, Number(a.messageId)));
        const c = m && await data.getContact(m.contactId);
        if (!c) throw new AIError("Draft not found.");
        send({ type: "step", text: `Read ${c.name}'s details and notes` });
        const [co] = c.companyId ? await db.select().from(companies).where(eq(companies.id, c.companyId)) : [];
        if (co) send({ type: "step", text: `Read ${co.name} notes and news` });
        const prior = (await db.select().from(messages).where(eq(messages.contactId, c.id)).orderBy(messages.id))
          .filter((p) => p.id !== m.id);
        if (prior.length) send({ type: "step", text: `Read ${plural(prior.length, "earlier email")}` });
        const prompt = ai.editPrompt({ subject: String(a.subject), body: String(a.body) }, history, String(a.request),
          await data.getProfile(), c, co ?? null, prior);
        for await (const e of ai.streamEdit(prompt)) send(e);
      } catch (e) {
        if (!(e instanceof AIError || e instanceof OpenAI.APIError)) console.error(e);
        send({ type: "error", text: e instanceof AIError || e instanceof OpenAI.APIError ? e.message : "Something went wrong." });
      }
      ctl.close();
    },
  }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
