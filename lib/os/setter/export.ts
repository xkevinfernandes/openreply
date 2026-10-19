// "Download as markdown": one knowledge base as a single readable file, for
// backups and for reading it outside the app. Sections mirror the old files
// (offer.md, offers.md, funnel.md, voice.md, conversation-examples.md,
// voice-corrections.md) so a person can find their way around it.

import { BUSINESS_FIELDS, correctionsMarkdown, type Offer, type SetterProfile } from "@/lib/os/setter/profile";
import type { CatalogRow } from "@/lib/os/setter/types";

export interface ExportResource {
  row: CatalogRow;
  enabled: boolean;
}

const OFFER_LINES: (keyof Offer)[] = [
  "status",
  "sold_by",
  "price",
  "price_in_dms",
  "length",
  "open_from",
  "open_until",
  "doc_url",
  "payment_url",
  "pitch",
  "fit_criteria",
];

function block(title: string, body: string | undefined | null): string {
  const b = (body ?? "").trim();
  return `## ${title}\n\n${b || "_(empty)_"}\n`;
}

export function setterMarkdown(p: SetterProfile, resources: ExportResource[], exportedAt: Date = new Date()): string {
  const s = p.settings ?? {};
  const out: string[] = [
    `# ${p.name} — knowledge base`,
    "",
    `Exported ${exportedAt.toISOString().slice(0, 16).replace("T", " ")} UTC from DM OS. ` +
      "The Setting Script (the shared method) is not included: it ships with the code.",
    "",
    `- Account: @${s.ig_username || "?"}`,
    `- Operator: ${s.operator || "?"}`,
    `- Audience: ${(s.audience || "b2b").toUpperCase()}`,
    `- Allowed emojis: ${(s.allowed_emojis ?? []).join(" ") || "none"}`,
    "",
    ...(p.persona?.trim() ? [block("Who you are", p.persona)] : []),
    block("Voice", p.voice),
    block("Voice examples", p.voiceExamples),
    "## The business\n",
  ];
  for (const f of BUSINESS_FIELDS) out.push(`### ${f.label}\n\n${(p.business.sections[f.key] ?? "").trim() || "_(unknown — J won't claim anything)_"}\n`);
  out.push("## Objections\n");
  if (!p.business.objections.length) out.push("_(none)_\n");
  for (const o of p.business.objections) out.push(`### ${o.objection}\n\n${o.response.trim()}\n`);
  out.push("## Offers\n");
  if (!p.offers.length) out.push("_(none)_\n");
  for (const o of p.offers) {
    const lines = OFFER_LINES.filter((k) => o[k]).map((k) => `${k}: ${String(o[k]).replace(/\n/g, " ")}`);
    out.push(`### ${o.name}\n\n${lines.join("\n")}${o.notes ? `\n\n${o.notes.trim()}` : ""}\n`);
  }
  out.push("## Funnel\n");
  if (!p.funnel.length) out.push("_(none)_\n");
  for (const st of p.funnel) out.push(`### ${st.label}\n\n${st.guidance.trim()}\n`);
  out.push("## Lead magnets\n");
  const magnets = resources.filter((r) => r.row.type !== "setter");
  if (!magnets.length) out.push("_(none)_\n");
  else
    out.push(
      magnets
        .map(
          (r) =>
            `- [${r.enabled ? "x" : " "}] **${r.row.name}** (${r.row.status}) ${r.row.zernio?.button_url || r.row.resource_url || "(no link)"}` +
            (r.row.for_setter ? `\n  ${r.row.for_setter.replace(/\n/g, " ")}` : "")
        )
        .join("\n") + "\n"
    );
  if (p.episodes?.length) {
    out.push("## Best episodes\n");
    out.push(p.episodes.map((e, i) => `${i + 1}. **${e.name}** ${e.link}${e.when ? ` — ${e.when.replace(/\n/g, " ")}` : ""}`).join("\n") + "\n");
  }
  if (p.fields?.length) {
    out.push("## Fields J fills\n");
    out.push(p.fields.map((f) => `- ${f.label} (\`${f.key}\`, ${f.type.toLowerCase()})`).join("\n") + "\n");
  }
  out.push(block("Conversation examples", p.examples));
  out.push(block("Voice corrections", correctionsMarkdown(p.voiceCorrections).replace(/^## /gm, "### ")));
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
