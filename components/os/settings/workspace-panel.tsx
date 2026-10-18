"use client";

// Workspace: name, team and invites, through OpenReply's /api/workspace/members
// (the same route the old Settings page uses).

import { useCallback, useEffect, useState } from "react";

type Role = "OWNER" | "ADMIN" | "MEMBER";
interface Members {
  currentUserRole: Role;
  members: { id: string; role: Role; user: { email: string | null; name: string | null } }[];
  invitations: { id: string; email: string; role: Role; inviteUrl: string; expiresAt: string }[];
}

const ROLE: Record<Role, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };

export default function WorkspacePanel({ workspaceName }: { workspaceName: string }) {
  const [data, setData] = useState<Members | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [copied, setCopied] = useState<string | null>(null);

  const send = useCallback(async (method: string, body?: unknown) => {
    const res = await fetch("/api/workspace/members", {
      method,
      cache: "no-store",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const p = await res.json().catch(() => ({}));
    if (!res.ok || !p.success) throw new Error(p.error || "Couldn't update the team.");
    return p.data as Members | undefined;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const d = await send("GET");
      if (d) setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the team.");
    }
  }, [send]);

  useEffect(() => {
    // Fetch on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const canManage = data?.currentUserRole === "OWNER" || data?.currentUserRole === "ADMIN";

  return (
    <div className="os-set-stack">
      <section className="os-set-section" aria-labelledby="os-set-ws">
        <header className="os-set-section-head">
          <h2 id="os-set-ws">Workspace</h2>
        </header>
        <dl className="os-set-facts">
          <div>
            <dt>Name</dt>
            <dd>{workspaceName}</dd>
          </div>
          <div>
            <dt>Your role</dt>
            <dd>{data ? ROLE[data.currentUserRole] : "…"}</dd>
          </div>
        </dl>
      </section>

      <section className="os-set-section" aria-labelledby="os-set-team">
        <header className="os-set-section-head">
          <h2 id="os-set-team">Team</h2>
          <p>Admins can manage automations, settings and the team. Members can work the inbox.</p>
        </header>
        {error && (
          <p className="os-kb-note" data-kind="error" role="alert">
            {error}
          </p>
        )}
        <ul className="os-set-list">
          {data?.members.map((m) => (
            <li key={m.id} className="os-set-item">
              <div className="os-set-item-text">
                <strong>{m.user.name ?? m.user.email ?? "Unknown"}</strong>
                {m.user.name && m.user.email && <span>{m.user.email}</span>}
              </div>
              <span className="chip quiet">{ROLE[m.role]}</span>
            </li>
          ))}
          {data?.invitations.map((inv) => (
            <li key={inv.id} className="os-set-item" data-pending="true">
              <div className="os-set-item-text">
                <strong>{inv.email}</strong>
                <span>Invited as {ROLE[inv.role].toLowerCase()} · expires {new Date(inv.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              </div>
              <span className="os-set-item-actions">
                <button
                  type="button"
                  className="os-button ghost"
                  onClick={() => {
                    void navigator.clipboard?.writeText(inv.inviteUrl);
                    setCopied(inv.id);
                    window.setTimeout(() => setCopied((c) => (c === inv.id ? null : c)), 1500);
                  }}
                >
                  {copied === inv.id ? "Copied" : "Copy link"}
                </button>
                {canManage && (
                  <button
                    type="button"
                    className="os-button danger"
                    disabled={busy === inv.id}
                    onClick={async () => {
                      setBusy(inv.id);
                      try {
                        await send("DELETE", { invitationId: inv.id });
                        await refresh();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Couldn't revoke it.");
                      }
                      setBusy(null);
                    }}
                  >
                    Revoke
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>

        {canManage && (
          <form
            className="os-set-invite"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy("invite");
              setError(null);
              try {
                const d = await send("POST", { email, role });
                if (d) setData(d);
                setEmail("");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Couldn't invite them.");
              }
              setBusy(null);
            }}
          >
            <label className="sr-only" htmlFor="os-set-invite-email">
              Email
            </label>
            <input id="os-set-invite-email" className="os-input" type="email" required placeholder="teammate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <span className="os-select">
              <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")}>
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
            </span>
            <button type="submit" className="os-button primary" disabled={busy === "invite" || !email}>
              {busy === "invite" ? "Inviting…" : "Invite"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
