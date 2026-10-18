import { Archivo, Inter } from "next/font/google";
import { redirect } from "next/navigation";
import OsShell from "@/components/os/os-shell";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser } from "@/lib/workspace";
import "./os.css";

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata = { title: "DM OS" };

export default async function OsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/os");

  const workspace = await ensureWorkspaceForUser(session.user.id, session.user.email);
  const account = await prisma.instagramAccount.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { connectedAt: "desc" },
    select: { username: true },
  });

  return (
    <div className={`os ${archivo.variable} ${inter.variable}`}>
      <OsShell workspaceName={workspace.name} instagramUsername={account?.username ?? null}>
        {children}
      </OsShell>
    </div>
  );
}
