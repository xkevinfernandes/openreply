"use client";

// Phone tab (borrowed from the WorkflowB board): the selected step as
// Instagram DM bubbles, with {first_name} filled for a sample contact.

import { useState } from "react";
import { resourceName, type BuilderContext } from "@/components/os/workflows/context";
import { fillVars } from "@/components/os/workflows/forms";
import type { GraphNode, StepData } from "@/lib/os/workflows/graph";

const PEOPLE = [
  { username: "tom.k", first: "Tom" },
  { username: "lena.fit", first: "Lena" },
  { username: "maya.builds", first: "Maya" },
];

function host(url: string | undefined | null): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function PhonePreview({ node, ctx }: { node: GraphNode; ctx: BuilderContext }) {
  const [who, setWho] = useState(PEOPLE[0]);
  const vars = { first_name: who.first, username: who.username };
  const out: React.ReactNode[] = [];

  if (node.type === "trigger") {
    const d = node.data as StepData<"trigger">;
    const kw = d.keywords[0] ?? "KEYWORD";
    if (d.kind === "comment") {
      out.push(
        <div key="c" className="wf-ph-comment">
          <b>{who.username}</b> {kw.toLowerCase()}
        </div>
      );
      if (d.publicReplies[0]) {
        out.push(
          <div key="r" className="wf-ph-comment wf-ph-reply">
            <b>claudepreneur</b> {fillVars(d.publicReplies[0], vars)}
          </div>
        );
      }
    } else {
      out.push(
        <div key="i" className="wf-ph-b" data-side="in">
          {kw}
        </div>
      );
    }
  } else if (node.type === "message") {
    for (const [i, b] of ((node.data as StepData<"message">).bubbles ?? []).entries()) {
      if (b.kind === "text") out.push(<div key={i} className="wf-ph-b">{fillVars(b.text, vars) || "…"}</div>);
      else if (b.kind === "link") {
        const res = ctx.resources.find((r) => r.slug === b.resourceSlug);
        const url = res?.link ?? b.url ?? "";
        out.push(
          <div key={i} className="wf-ph-link">
            <span className="wf-ph-url">{url.replace(/^https?:\/\//, "") || "link"}</span>
            <span className="wf-ph-card">
              <b>{b.resourceSlug ? resourceName(ctx, b.resourceSlug) : host(url) || "Link"}</b>
              <span>{host(url)}</span>
            </span>
          </div>
        );
      } else if (b.kind === "buttons") {
        out.push(
          <div key={i} className="wf-ph-btncard">
            <span>{fillVars(b.text, vars) || "…"}</span>
            {b.buttons.map((x) => (
              <span key={x.id} className="wf-ph-btn">
                {x.label || "Button"}
              </span>
            ))}
          </div>
        );
      } else if (b.kind === "quick_replies") {
        out.push(<div key={i} className="wf-ph-b">{fillVars(b.text, vars) || "…"}</div>);
        out.push(
          <div key={`${i}-qr`} className="wf-ph-chips">
            {b.options.map((x) => (
              <span key={x.id} className="wf-ph-chip">
                {x.label || "Option"}
              </span>
            ))}
          </div>
        );
      } else out.push(<div key={i} className="wf-ph-b wf-ph-img">Image</div>);
    }
  } else if (node.type === "ask") {
    const d = node.data as StepData<"ask">;
    out.push(<div key="q" className="wf-ph-b">{fillVars(d.question, vars) || "…"}</div>);
    out.push(
      <div key="a" className="wf-ph-b" data-side="in">
        {d.validate === "email" ? `${who.first.toLowerCase()}@gmail` : d.validate === "number" ? "about 5k" : "…"}
      </div>
    );
    if (d.retry) out.push(<div key="r" className="wf-ph-b">{fillVars(d.retry, vars)}</div>);
  }

  return (
    <div className="wf-phone-wrap">
      <label className="wf-field-row wf-lab">
        Preview as
        <select className="os-input wf-select" aria-label="Preview as contact" value={who.username} onChange={(e) => setWho(PEOPLE.find((p) => p.username === e.target.value) ?? PEOPLE[0])}>
          {PEOPLE.map((p) => (
            <option key={p.username} value={p.username}>
              {p.username}
            </option>
          ))}
        </select>
      </label>
      <div className="wf-phone" role="img" aria-label="Instagram DM preview">
        <div className="wf-ph-head">
          <span className="wf-ph-av">{who.first.charAt(0)}</span>
          <span className="wf-ph-who">
            <b>{who.first}</b>
            <span>{who.username}</span>
          </span>
        </div>
        <div className="wf-ph-list">{out}</div>
        <div className="wf-ph-compose">Message…</div>
      </div>
    </div>
  );
}
