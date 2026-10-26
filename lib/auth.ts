import NextAuth, { type NextAuthConfig } from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";
import { isEmailAllowedToSignIn } from "@/lib/env";

type AdapterPrismaClient = Parameters<typeof PrismaAdapter>[0];

const emailFrom = process.env.EMAIL_FROM ?? "OpenReply <login@example.com>";
// Setting EMAIL_SERVER switches magic links to your own SMTP server, for
// self-hosters who do not want a third-party mail service. Resend stays the
// default, so an existing deployment is unaffected.
const smtpServer = process.env.EMAIL_SERVER;

/**
 * Provider id the login form has to sign in with. It differs per transport,
 * so it is derived here rather than hardcoded at the call site.
 */
export const EMAIL_PROVIDER_ID = smtpServer ? "nodemailer" : "resend";

export const authConfig = {
  adapter: PrismaAdapter(prisma as unknown as AdapterPrismaClient),
  providers: [
    smtpServer
      ? Nodemailer({ server: smtpServer, from: emailFrom })
      : Resend({
          apiKey: process.env.RESEND_API_KEY ?? "missing-resend-api-key",
          from: emailFrom,
        }),
  ],
  callbacks: {
    // Runs before the magic link is sent, so a blocked address never receives
    // one, and again when the link is verified.
    async signIn({ user }) {
      return isEmailAllowedToSignIn(user?.email);
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) {
        await ensureWorkspaceForUser(user.id, user.email);
      }
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  session: {
    strategy: "database",
  },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
} satisfies NextAuthConfig;

const nextAuth = NextAuth(authConfig);
export const { handlers, signIn, signOut } = nextAuth;

// With OS_MOCK=1 (local dev only, never production) a visitor with no session
// is signed in as a local test user, so the mock OS opens without a magic link.
const MOCK_USER = { id: "os-mock-user", email: "mock@dm-os.local", name: "Kevin" };

async function ensureMockUser() {
  try {
    await prisma.user.upsert({ where: { id: MOCK_USER.id }, update: {}, create: MOCK_USER });
  } catch (err) {
    // The layout and the page sign in at once on a fresh database: the other one made it.
    if ((err as { code?: string })?.code !== "P2002") throw err;
  }
  await ensureWorkspaceForUser(MOCK_USER.id, MOCK_USER.email);
}

async function mockSession() {
  // One sign-up per process, shared by concurrent requests (globalThis: dev
  // can load this module more than once).
  const g = globalThis as { __osMockUser?: Promise<void> };
  g.__osMockUser ??= ensureMockUser().catch((err) => {
    g.__osMockUser = undefined;
    throw err;
  });
  await g.__osMockUser;
  return { user: MOCK_USER, expires: new Date(Date.now() + 86400_000).toISOString() };
}

export const auth = (async (...args: unknown[]) => {
  if (args.length > 0) return (nextAuth.auth as (...a: unknown[]) => unknown)(...args);
  const session = await nextAuth.auth();
  if (!session && process.env.OS_MOCK === "1" && process.env.NODE_ENV !== "production") {
    return mockSession();
  }
  return session;
}) as typeof nextAuth.auth;

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const workspace = await getPrimaryWorkspace(userId);
  if (workspace) return workspace.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const createdWorkspace = await ensureWorkspaceForUser(userId, user?.email);
  return createdWorkspace.id;
}
