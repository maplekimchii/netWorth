// One Microsoft login gates the app and connects Outlook. Tokens go to outlook_tokens, not the session cookie.
import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { db } from "@/db";
import { outlookTokens } from "@/db/schema";
import { OUTLOOK_SCOPES } from "@/lib/outlook";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      authorization: { params: { scope: `openid profile email offline_access ${OUTLOOK_SCOPES}` } },
    }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    signIn({ user, profile }) {
      const email = (user.email ?? (profile?.preferred_username as string | undefined) ?? "").toLowerCase();
      return email !== "" && email === process.env.ALLOWED_EMAIL?.toLowerCase();
    },
    async jwt({ token, account }) {
      if (account?.access_token && account.refresh_token && account.expires_at) {
        const row = {
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          scope: account.scope ?? "",
        };
        await db.insert(outlookTokens).values({ id: 1, ...row })
          .onConflictDoUpdate({ target: outlookTokens.id, set: row });
      }
      return token;
    },
    authorized: ({ auth }) => !!auth,
  },
});
