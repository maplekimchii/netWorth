// Microsoft Graph access using the token row saved at login. Refreshes the access token when it expires.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outlookTokens } from "@/db/schema";

const GRAPH = "https://graph.microsoft.com/v1.0";
// Set OUTLOOK_SCOPES="Mail.ReadWrite User.Read" if the tenant blocks consent for Mail.Send.
export const OUTLOOK_SCOPES = process.env.OUTLOOK_SCOPES ?? "Mail.ReadWrite Mail.Send User.Read";

export class OutlookError extends Error {}
export class NotConnected extends OutlookError {}

// The issuer is https://login.microsoftonline.com/<tenant>/v2.0; the token endpoint sits beside it.
const tokenUrl = () => process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER!.replace(/\/v2\.0\/?$/, "/oauth2/v2.0/token");

// ponytail: two concurrent refreshes can race; Entra keeps the old refresh token valid, so the loser still works.
async function accessToken(): Promise<string> {
  const [row] = await db.select().from(outlookTokens).where(eq(outlookTokens.id, 1));
  if (!row) throw new NotConnected("Outlook is not connected. Sign out and back in.");
  if (Date.now() / 1000 < row.expiresAt - 60) return row.accessToken;

  const res = await fetch(tokenUrl(), {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
      client_secret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
      grant_type: "refresh_token",
      refresh_token: row.refreshToken,
      scope: `offline_access ${OUTLOOK_SCOPES}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new NotConnected(`Outlook login expired (${data.error ?? res.status}). Sign out and back in.`);
  const next = {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string | undefined) ?? row.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000 + data.expires_in),
    scope: (data.scope as string | undefined) ?? row.scope,
  };
  await db.update(outlookTokens).set(next).where(eq(outlookTokens.id, 1));
  return next.accessToken;
}

export async function graph<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(GRAPH + path, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof OutlookError) throw e;
    throw new OutlookError(`Could not reach Outlook: ${(e as Error).message}`);
  }
  if (res.status === 401) throw new NotConnected("Outlook login expired. Sign out and back in.");
  if (!res.ok) throw new OutlookError(`Outlook returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (res.status === 202 || res.status === 204 ? undefined : await res.json()) as T;
}

/** Scopes the tenant actually granted, so the UI can hide Send when Mail.Send was refused. */
export async function grantedScopes(): Promise<string[]> {
  const [row] = await db.select({ scope: outlookTokens.scope }).from(outlookTokens).where(eq(outlookTokens.id, 1));
  return row?.scope.split(" ").filter(Boolean) ?? [];
}
