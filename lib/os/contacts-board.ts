// The Contacts screen (build step 5): every contact as a table or a Kanban
// board. One read per page load; filtering, search and selection happen in
// the browser (lib/os/contacts-filter.ts), so the board stays instant.

import type { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/db/client";
import { mockContactExtras, mockThreads, osMockEnabled } from "@/lib/os/mock";
import { pendingDrafts } from "@/lib/os/setter/service";

export interface ContactRow {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  kind: ContactKind;
  stage: ContactStage;
  setterStage: string | null;
  entryPath: string | null;
  tags: string[];
  paused: boolean;
  notes: string | null;
  email: string | null;
  lastMessageAt: string | null;
  zernioConversationId: string | null;
  /** Null = the default setter for the account. */
  setterId: string | null;
  /** J has a draft waiting for approval. */
  draftWaiting: boolean;
}

export interface SetterOption {
  id: string;
  name: string;
}

export interface ContactsData {
  contacts: ContactRow[];
  setters: SetterOption[];
  /** True when the read hit the cap: the oldest contacts are not shown. */
  truncated: boolean;
}

/** Most contacts one page load reads, newest message first. */
export const CONTACTS_CAP = 2000;

async function draftContactIds(workspaceId: string): Promise<Set<string>> {
  try {
    return new Set((await pendingDrafts(workspaceId)).map((d) => d.contactId));
  } catch (err) {
    console.error("[OS Contacts] drafts failed:", err instanceof Error ? err.message : err);
    return new Set();
  }
}

function mockContacts(drafts: Set<string>): ContactRow[] {
  return mockThreads().flatMap((t) => {
    if (!t.contact) return [];
    const x = mockContactExtras(t.contact.id);
    return [
      {
        id: t.contact.id,
        username: t.username,
        fullName: t.fullName ?? null,
        avatarUrl: t.avatarUrl ?? null,
        kind: t.contact.kind,
        stage: t.contact.stage,
        setterStage: t.contact.setterStage,
        entryPath: t.contact.entryPath,
        tags: [...x.tags],
        paused: t.contact.paused,
        notes: x.notes,
        email: x.email,
        lastMessageAt: t.updatedTime,
        zernioConversationId: t.conversationId,
        setterId: null,
        draftWaiting: drafts.has(t.contact.id),
      },
    ];
  });
}

export async function listContacts(workspaceId: string): Promise<ContactsData> {
  const drafts = await draftContactIds(workspaceId);
  if (osMockEnabled()) return { contacts: mockContacts(drafts), setters: [], truncated: false };

  const [rows, setters] = await Promise.all([
    prisma.contact.findMany({
      where: { workspaceId },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: CONTACTS_CAP + 1,
      select: {
        id: true,
        username: true,
        fullName: true,
        avatarUrl: true,
        kind: true,
        stage: true,
        setterStage: true,
        entryPath: true,
        tags: true,
        paused: true,
        notes: true,
        email: true,
        lastMessageAt: true,
        zernioConversationId: true,
        setterId: true,
      },
    }),
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return {
    contacts: rows.slice(0, CONTACTS_CAP).map((c) => ({
      ...c,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      draftWaiting: drafts.has(c.id),
    })),
    setters,
    truncated: rows.length > CONTACTS_CAP,
  };
}
