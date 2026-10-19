import Link from "next/link";
import { KbIcon, type KbIconName } from "@/components/os/knowledge/icons";
import type { SetterEditorView } from "@/lib/os/knowledge";
import { DOC_FILES, DOC_KEYS, type DocKey } from "@/lib/os/setter/knowledge/docs";

export const SETUP_KEYS = ["funnel", "lead-magnets", "voice-notes", "booking", "fields", "follow-ups", "tests", "corrections", "autopilot", "profile"] as const;
export type SetupKey = (typeof SETUP_KEYS)[number];

/** What the right pane shows: a file or a Setup page. */
export type TreeSel = { file: DocKey } | { setup: SetupKey };

/** The pages the pane can show. "autopilot" is an old link: it lives on Funnel now. */
export type SetupPage = Exclude<SetupKey, "autopilot">;

export function isSetupKey(k: unknown): k is SetupKey {
  return typeof k === "string" && (SETUP_KEYS as readonly string[]).includes(k);
}

export function pageOf(setup: SetupKey): SetupPage {
  return setup === "autopilot" ? "funnel" : setup;
}

export function hrefFor(sel: TreeSel): string {
  if ("file" in sel) return `?f=${sel.file}`;
  return `?s=${pageOf(sel.setup)}`;
}

export interface BookingState {
  label: string;
  live: boolean;
}

export function bookingState(view: Pick<SetterEditorView, "booking">): BookingState {
  const b = view.booking;
  if (b.mode === "calendar" && b.calendar) return { label: "Live", live: true };
  return { label: b.link || b.inheritedLink ? "Link" : "Off", live: false };
}

const SETUP: { key: SetupPage; label: string; icon: KbIconName; meta: (v: SetterEditorView) => React.ReactNode }[] = [
  {
    key: "funnel",
    label: "Funnel",
    icon: "funnel",
    meta: (v) => {
      const auto = v.funnel.filter((s) => s.autopilot === "auto").length;
      return auto ? `${v.funnel.length} · ${auto} auto` : `${v.funnel.length} stages`;
    },
  },
  {
    key: "lead-magnets",
    label: "Lead magnets",
    icon: "gift",
    meta: (v) => `${v.resources.filter((r) => r.kind === "resource" && v.enabledResourceIds.includes(r.id)).length} on`,
  },
  { key: "voice-notes", label: "Voice notes", icon: "mic", meta: (v) => `${v.voice.recorded}/${v.voice.total}` },
  {
    key: "booking",
    label: "Booking",
    icon: "calendar",
    meta: (v) => {
      const s = bookingState(v);
      return (
        <>
          {s.live && <span className="kb-live" aria-hidden="true" />}
          {s.label}
        </>
      );
    },
  },
  { key: "fields", label: "Fields J fills", icon: "table", meta: (v) => v.fields.filter((f) => f.on).length },
  { key: "follow-ups", label: "Follow-ups", icon: "clock", meta: (v) => Object.values(v.sequences).filter((s) => s.enabled).length },
  { key: "tests", label: "Tests", icon: "flask", meta: () => null },
  { key: "corrections", label: "Voice corrections", icon: "pencil", meta: (v) => v.voiceCorrections.length },
  { key: "profile", label: "Profile", icon: "user", meta: (v) => (v.settings.ig_username ? `@${v.settings.ig_username}` : null) },
];

export function SetterTree({ view, sel }: { view: SetterEditorView; sel: TreeSel }) {
  const fileMeta = (key: DocKey) => {
    if (key === "system_prompt") return "voice";
    return view.docs.find((d) => d.key === key)?.count ?? null;
  };
  const current = (s: TreeSel) =>
    "file" in s ? "file" in sel && sel.file === s.file : "setup" in sel && pageOf(sel.setup) === s.setup;
  return (
    <aside aria-label="Setter files" className="kb-tree">
      <div className="kb-grp">Files</div>
      {DOC_KEYS.map((key) => {
        const on = current({ file: key });
        const meta = fileMeta(key);
        return (
          <Link key={key} href={hrefFor({ file: key })} aria-current={on ? "page" : undefined}>
            <KbIcon name="file" />
            {DOC_FILES[key].file}
            {meta !== null && <span className="kb-meta">{meta}</span>}
          </Link>
        );
      })}
      <div className="kb-grp">Setup</div>
      {SETUP.map((it) => {
        const on = current({ setup: it.key });
        const meta = it.meta(view);
        return (
          <Link key={it.key} href={hrefFor({ setup: it.key })} aria-current={on ? "page" : undefined}>
            <KbIcon name={it.icon} />
            {it.key === "fields" ? `Fields ${view.name} fills` : it.label}
            {meta !== null && meta !== "" && <span className="kb-meta">{meta}</span>}
          </Link>
        );
      })}
    </aside>
  );
}
