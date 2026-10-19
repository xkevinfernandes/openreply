"use client";

// New test: where the line goes, the variants (with starters from the
// research), how people are split, and when the table may judge.

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createExperiment } from "@/app/(os)/os/automations/tests/actions";
import type { CreateOptions } from "@/lib/os/experiments/data";
import type { Suggestion } from "@/lib/os/experiments/suggestions";
import type { AllocationName } from "@/lib/os/experiments/types";

type Kind = "campaign_opener" | "j_opener" | "line";

interface Props {
  options: CreateOptions;
  entries: { key: string; label: string }[];
  lines: { key: string; label: string }[];
  suggestions: Record<string, Suggestion[]>;
}

interface Draft {
  id: number;
  text: string;
  weight: number;
  style: string | null;
}

const KINDS: { key: Kind; label: string; help: string }[] = [
  { key: "campaign_opener", label: "Campaign opening DM", help: "The first message OpenReply sends when someone comments." },
  { key: "j_opener", label: "J's opener", help: "J's first message to them, e.g. after the resource went out." },
  { key: "line", label: "J's key line", help: "A line J uses mid-conversation: the permission ask, value offer, invite or first follow-up." },
];

let seq = 0;
const blank = (text = "", style: string | null = null): Draft => ({ id: ++seq, text, weight: 1, style });

export default function ExperimentForm({ options, entries, lines, suggestions }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("campaign_opener");
  const firstCampaign =
    options.campaigns.find((c) => c.openingDm && !options.busySlots.includes(`campaign_opener:${c.id}`)) ?? options.campaigns.find((c) => c.openingDm);
  const [campaignId, setCampaignId] = useState(firstCampaign?.id ?? "");
  const [entry, setEntry] = useState("any");
  const [line, setLine] = useState(lines[0]?.key ?? "permission_ask");
  const [setterId, setSetterId] = useState("");
  const [name, setName] = useState("");
  const [allocation, setAllocation] = useState<AllocationName>("EVEN");
  const [minSends, setMinSends] = useState(50);
  const [variants, setVariants] = useState<Draft[]>(() => [blank(firstCampaign?.openingDm ?? "", "original"), blank()]);

  const slot = kind === "campaign_opener" ? `campaign_opener:${campaignId}` : kind === "j_opener" ? `j_opener:${entry}` : `line:${line}`;
  const busy = options.busySlots.includes(slot);
  const campaign = options.campaigns.find((c) => c.id === campaignId);
  const ideas = kind === "line" ? (suggestions[line] ?? []) : (suggestions.opener ?? []);
  const unusedIdeas = ideas.filter((s) => !variants.some((v) => v.text.trim() === s.text));
  const defaultName = useMemo(() => {
    if (kind === "campaign_opener") return campaign ? `${campaign.name}: opening DM` : "Opening DM";
    if (kind === "j_opener") return `J's opener · ${entries.find((e) => e.key === entry)?.label ?? entry}`;
    return lines.find((l) => l.key === line)?.label ?? "J's line";
  }, [kind, campaign, entry, line, entries, lines]);

  const update = (id: number, patch: Partial<Draft>) => setVariants((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));

  const pickCampaign = (id: string) => {
    setCampaignId(id);
    const c = options.campaigns.find((x) => x.id === id);
    // Variant A starts as the campaign's own opener: the control.
    setVariants((vs) => {
      const [first, ...rest] = vs;
      if (first && (first.style === "original" || !first.text.trim())) return [{ ...first, text: c?.openingDm ?? "", style: "original" }, ...rest];
      return vs;
    });
  };

  const chooseKind = (k: Kind) => {
    setKind(k);
    // The campaign's own opener is the control only for a campaign test.
    setVariants((vs) => {
      const [first, ...rest] = vs;
      if (!first) return vs;
      if (k !== "campaign_opener" && first.style === "original") return [{ ...first, text: "", style: null }, ...rest];
      if (k === "campaign_opener" && !first.text.trim()) return [{ ...first, text: campaign?.openingDm ?? "", style: "original" }, ...rest];
      return vs;
    });
  };

  const addIdea = (s: Suggestion) =>
    setVariants((vs) => {
      const empty = vs.find((v) => !v.text.trim());
      if (empty) return vs.map((v) => (v.id === empty.id ? { ...v, text: s.text, style: s.style } : v));
      return vs.length >= 6 ? vs : [...vs, blank(s.text, s.style)];
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const r = await createExperiment({
        name: name.trim() || defaultName,
        slot,
        setterId: kind === "campaign_opener" ? null : setterId || null,
        allocation,
        minSends,
        variants: variants.map((v) => ({ text: v.text, weight: v.weight, style: v.style })),
      });
      if (r.error) return setError(r.error);
      router.push("/os/automations/tests");
      router.refresh();
    });
  };

  return (
    <form className="os-exp-form" onSubmit={submit}>
      <fieldset className="os-exp-step">
        <legend>Where the line goes</legend>
        <div className="os-exp-kinds" role="radiogroup" aria-label="Where the line goes">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              role="radio"
              aria-checked={kind === k.key}
              className="os-exp-kind"
              onClick={() => chooseKind(k.key)}
            >
              <strong>{k.label}</strong>
              <span>{k.help}</span>
            </button>
          ))}
        </div>

        <div className="os-exp-fields">
          {kind === "campaign_opener" && (
            <label className="os-exp-field">
              <span>Campaign</span>
              <span className="os-select">
                <select value={campaignId} onChange={(e) => pickCampaign(e.target.value)}>
                  {!options.campaigns.length && <option value="">No campaigns yet</option>}
                  {options.campaigns.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.openingDm}>
                      {c.name}
                      {!c.openingDm ? " (no opening DM)" : options.busySlots.includes(`campaign_opener:${c.id}`) ? " (test running)" : ""}
                    </option>
                  ))}
                </select>
              </span>
              <small>Only campaigns with an opening DM (and its button) can be tested. Turn it on in the campaign first.</small>
            </label>
          )}
          {kind === "j_opener" && (
            <label className="os-exp-field">
              <span>When they arrived through</span>
              <span className="os-select">
                <select value={entry} onChange={(e) => setEntry(e.target.value)}>
                  {entries.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </span>
              <small>A test on one entry beats an &quot;Any entry&quot; test for those people.</small>
            </label>
          )}
          {kind === "line" && (
            <label className="os-exp-field">
              <span>Line</span>
              <span className="os-select">
                <select value={line} onChange={(e) => setLine(e.target.value)}>
                  {lines.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </span>
              <small>J uses the line only when its moment comes. Holding is still fine.</small>
            </label>
          )}
          {kind !== "campaign_opener" && options.setters.length > 1 && (
            <label className="os-exp-field">
              <span>Setter</span>
              <span className="os-select">
                <select value={setterId} onChange={(e) => setSetterId(e.target.value)}>
                  <option value="">Every setter</option>
                  {options.setters.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          )}
        </div>
        {busy && <p className="os-exp-warn">A test is already running here. Pause or finish it before starting another.</p>}
      </fieldset>

      <fieldset className="os-exp-step">
        <legend>Variants</legend>
        <ol className="os-exp-variants">
          {variants.map((v, i) => (
            <li key={v.id}>
              <span className="os-exp-label" aria-hidden="true">
                {String.fromCharCode(65 + i)}
              </span>
              <div className="os-exp-variant-body">
                <textarea
                  className="os-textarea"
                  rows={2}
                  value={v.text}
                  aria-label={`Variant ${String.fromCharCode(65 + i)}`}
                  placeholder={i === 0 && kind === "campaign_opener" ? "The campaign's current opener" : "Write it the way you'd say it"}
                  onChange={(e) => update(v.id, { text: e.target.value, style: v.style === "original" ? "custom" : v.style })}
                />
                <div className="os-exp-variant-meta">
                  {v.style === "original" && <span className="chip quiet">Current opener (control)</span>}
                  {allocation === "WEIGHTED" && (
                    <label className="os-exp-weight">
                      Weight
                      <input
                        className="os-input"
                        type="number"
                        min={1}
                        max={100}
                        value={v.weight}
                        onChange={(e) => update(v.id, { weight: Number(e.target.value) })}
                      />
                    </label>
                  )}
                  {variants.length > 2 && (
                    <button type="button" className="os-link quiet" onClick={() => setVariants((vs) => vs.filter((x) => x.id !== v.id))}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="os-exp-add">
          <button type="button" className="os-button" disabled={variants.length >= 6} onClick={() => setVariants((vs) => [...vs, blank()])}>
            Add variant
          </button>
          <span className="os-exp-hint">Use {"{username}"} or {"{first_name}"} to say their name.</span>
        </div>

        {unusedIdeas.length > 0 && (
          <div className="os-exp-ideas">
            <h3>Starters from the research</h3>
            <ul>
              {unusedIdeas.map((s) => (
                <li key={s.style}>
                  <button type="button" className="os-exp-idea" onClick={() => addIdea(s)}>
                    <strong>{s.label}</strong>
                    <span className="os-exp-idea-text">&ldquo;{s.text}&rdquo;</span>
                    <small>{s.why}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      <fieldset className="os-exp-step">
        <legend>Split and judging</legend>
        <div className="os-exp-fields">
          <div className="os-exp-field">
            <span>Split people</span>
            <div className="os-segmented" role="group" aria-label="Split people">
              <button type="button" aria-pressed={allocation === "EVEN"} onClick={() => setAllocation("EVEN")}>
                Evenly
              </button>
              <button type="button" aria-pressed={allocation === "WEIGHTED"} onClick={() => setAllocation("WEIGHTED")}>
                By weight
              </button>
            </div>
            <small>Each person keeps the variant they got.</small>
          </div>
          <label className="os-exp-field">
            <span>Sends per variant before judging</span>
            <input className="os-input os-exp-num" type="number" min={10} max={5000} value={minSends} onChange={(e) => setMinSends(Number(e.target.value))} />
            <small>Under this, the table says &quot;too early&quot;. Small samples are hunches, not proof.</small>
          </label>
          <label className="os-exp-field os-exp-name">
            <span>Name</span>
            <input className="os-input" value={name} placeholder={defaultName} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
      </fieldset>

      <div className="os-exp-submit">
        {error && (
          <p className="os-exp-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="os-button primary" disabled={pending || busy}>
          {pending ? "Starting…" : "Start test"}
        </button>
      </div>
    </form>
  );
}
