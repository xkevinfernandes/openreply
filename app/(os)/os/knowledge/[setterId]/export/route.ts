// "Download as markdown": the whole knowledge base as one .md file.
import { getCurrentWorkspaceId } from "@/lib/auth";
import { setterMarkdown } from "@/lib/os/setter/export";
import { dbKnowledge } from "@/lib/os/setter/setters";
import { prisma } from "@/lib/db/client";
import { slugify } from "@/lib/os/setter/kb";

export async function GET(_req: Request, ctx: { params: Promise<{ setterId: string }> }) {
  const { setterId } = await ctx.params;
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return new Response("Sign in again.", { status: 401 });
  const setter = await dbKnowledge.forSetter(workspaceId, setterId);
  if (!setter) return new Response("Not found.", { status: 404 });
  const on = new Set(
    (await prisma.setterResource.findMany({ where: { setterId }, include: { resource: { select: { slug: true } } } })).map((r) => r.resource.slug)
  );
  const md = setterMarkdown(
    setter.profile,
    setter.catalog.resources.map((row) => ({ row, enabled: on.has(row.slug) }))
  );
  const file = `${slugify(setter.profile.name)}-knowledge-${new Date().toISOString().slice(0, 10)}.md`;
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
