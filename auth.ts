// GitHub login gates the app to one account. UWaterloo blocks third-party Microsoft apps, so there is no Outlook API.
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  pages: { signIn: "/login" },
  callbacks: {
    signIn({ profile }) {
      const login = String(profile?.login ?? "").toLowerCase();
      return login !== "" && login === process.env.ALLOWED_GITHUB_LOGIN?.toLowerCase();
    },
    authorized: ({ auth }) => !!auth,
  },
});
