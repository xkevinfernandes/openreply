"use client";

// One renderer per message part, Instagram style (InboxA): story reply with
// the story card, button template, reel/post share, link preview in its own
// bubble, voice note with a waveform and a one-line transcript that expands,
// photos, reactions. Unknown parts read as a short grey line. Owner: S1.

import { useRef, useState } from "react";
import type { MediaView } from "@/lib/os/media";
import type { MessagePart, RichMessage } from "@/lib/os/messages/types";
import { formatDuration, partAria, waveform } from "@/lib/os/messages/view";
import { partLabel } from "@/lib/os/messages/parse";

const Ico = ({ d, fill = false, size = 16 }: { d: string; fill?: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const IMG = "M3.5 3h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3ZM2.5 11 6 7.5l3 3 2-2 2.5 2.5";
const REEL = "M5 2h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3ZM2.5 5.5h11M6 2.5l1.5 3M10 2.5l1.5 3M7 8v3.5l3-1.75L7 8Z";
const PLAY = "M5 3.5v9l7-4.5-7-4.5Z";
const PAUSE = "M5 3.5v9M11 3.5v9";
const HEART = "M8 13.5S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5Z";

function Cover({ src, label, className }: { src: string | null; label: string; className: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={className} role="img" aria-label={label}>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <Ico d={IMG} size={24} />
      )}
    </div>
  );
}

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

function StoryReply({ part, media }: { part: Extract<MessagePart, { type: "story_reply" }>; media: MediaView | null }) {
  const story = media?.story ?? null;
  const caption = story?.caption ?? null;
  const when = shortDate(story?.postedAt ?? null);
  const label = `Story${when ? ` from ${when}` : ""}${caption ? `: ${caption}` : ""}`;
  const thumb = story?.thumbnailUrl ?? part.url;
  return (
    <>
      <span className="os-th-ctx">{part.mention ? "Mentioned you in their story" : "Replied to your story"}</span>
      <div className="os-th-story">
        <span className="os-th-story-bar" aria-hidden="true" />
        <a className="os-th-story-card" href={story?.permalink ?? undefined} target="_blank" rel="noreferrer" aria-label={label} data-has-thumb={thumb ? true : undefined}>
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" referrerPolicy="no-referrer" />
          ) : null}
          <span className="os-th-story-meta">Story{when ? ` · ${when}` : ""}</span>
          {caption ? <span className="os-th-story-cap">‘{caption}’</span> : null}
        </a>
      </div>
    </>
  );
}

/** A message with buttons, as Instagram draws it: the text in a bubble with
 *  the buttons stacked full width inside it. A generic card adds its image
 *  (only when it has one) and its subtitle. */
function Template({ part, mine }: { part: Extract<MessagePart, { type: "template" }>; mine: boolean }) {
  const card = Boolean(part.image || part.subtitle);
  return (
    <div
      className="os-th-buttons"
      data-mine={mine || undefined}
      data-card={card || undefined}
      role="group"
      aria-label={`Message with buttons${part.title ? `: ${part.title}` : ""}`}
    >
      {part.image ? <Cover src={part.image} label="Card image" className="os-th-buttons-img" /> : null}
      {part.title || part.subtitle ? (
        <div className="os-th-buttons-text">
          {part.title ? <span className="os-th-buttons-title">{part.title}</span> : null}
          {part.subtitle ? <span className="os-th-buttons-sub">{part.subtitle}</span> : null}
        </div>
      ) : null}
      {part.buttons.length ? (
        <div className="os-th-buttons-list">
          {part.buttons.map((b, i) =>
            b.url ? (
              <a key={i} className="os-th-buttons-btn" href={b.url} target="_blank" rel="noreferrer">
                {b.title}
              </a>
            ) : (
              <span key={i} className="os-th-buttons-btn">
                {b.title}
              </span>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

const SHARE_LABEL = { reel: "Reel", post: "Post", story: "Story" } as const;

function Share({ part, media }: { part: Extract<MessagePart, { type: "share" }>; media: MediaView | null }) {
  const caption = media?.caption ?? part.caption;
  // Zernio doesn't say whose post it is, so the head names the kind only.
  return (
    <a className="os-th-share" href={part.url ?? undefined} target="_blank" rel="noreferrer" aria-label={`Shared ${part.kind}${caption ? `: ${caption}` : ""}`}>
      <span className="os-th-share-head">
        <Ico d={part.kind === "post" ? IMG : REEL} size={14} />
        <span>{SHARE_LABEL[part.kind]}</span>
      </span>
      <span className="os-th-share-media" data-kind={part.kind} aria-hidden="true" />
      {caption ? <span className="os-th-share-cap">{caption}</span> : null}
    </a>
  );
}

function LinkCard({ part, mine }: { part: Extract<MessagePart, { type: "link" }>; mine: boolean }) {
  const shown = part.url.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return (
    <a className="os-th-link" data-mine={mine || undefined} href={part.url} target="_blank" rel="noreferrer" aria-label={`Link: ${part.title ?? shown}`}>
      <span className="os-th-link-url">{shown}</span>
      {part.title ? (
        <span className="os-th-link-card">
          <span className="os-th-link-title">{part.title}</span>
          <span className="os-th-link-domain">{part.domain}</span>
        </span>
      ) : null}
    </a>
  );
}

export function VoiceNote({ id, url, durationMs, transcript, mine }: { id: string; url: string | null; durationMs: number | null; transcript: string | null; mine: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState(false);
  const len = formatDuration(durationMs);
  function toggle() {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else {
      a.pause();
      setPlaying(false);
    }
  }
  return (
    <div className="os-th-voice-wrap" data-mine={mine || undefined}>
      <div className="os-th-voice" aria-label={`Voice note${durationMs ? `, ${Math.round(durationMs / 1000)} seconds` : ""}`}>
        <button type="button" className="os-th-voice-play" aria-label={playing ? "Pause voice note" : "Play voice note"} disabled={!url} onClick={toggle}>
          <Ico d={playing ? PAUSE : PLAY} fill={!playing} size={12} />
        </button>
        <span className="os-th-wave" aria-hidden="true">
          {waveform(id).map((h, i) => (
            <span key={i} style={{ height: h }} />
          ))}
        </span>
        {len ? <span className="os-th-voice-len">{len}</span> : null}
        {url ? <audio ref={audio} src={url} preload="none" onEnded={() => setPlaying(false)} /> : null}
      </div>
      {transcript ? (
        <button type="button" className="os-th-transcript" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={open ? undefined : transcript}>
          {transcript}
        </button>
      ) : null}
    </div>
  );
}

function Photo({ part, media, mine }: { part: Extract<MessagePart, { type: "image" | "video" }>; media: MediaView | null; mine: boolean }) {
  const [broken, setBroken] = useState(false);
  const label = media?.description ?? (part.type === "video" ? "Video" : "Photo");
  return (
    <div className="os-th-photo" data-mine={mine || undefined} title={media?.description ?? undefined}>
      {part.url && !broken ? (
        part.type === "video" ? (
          <video src={part.url} controls preload="metadata" onError={() => setBroken(true)} aria-label={label} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={part.url} alt={label} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        )
      ) : (
        <span className="os-th-photo-ph" role="img" aria-label={label}>
          <Ico d={IMG} size={20} />
          {media?.description ? <span>{media.description}</span> : <span>{part.type === "video" ? "Video" : "Photo"}</span>}
        </span>
      )}
    </div>
  );
}

const bubble = (mine: boolean, text: React.ReactNode, key?: React.Key) => (
  <div key={key} className="os-th-bubble" data-mine={mine || undefined}>
    {text}
  </div>
);

/** All of one message's parts, stacked. */
export function MessageParts({ m, media }: { m: RichMessage; media: MediaView | null }) {
  const mine = m.direction === "outgoing";
  if (m.deleted) return <div className="os-th-note">Unsent a message</div>;
  return (
    <>
      {m.parts.map((p, i) => {
        switch (p.type) {
          case "text":
            return bubble(mine, p.text, i);
          case "link":
            return <LinkCard key={i} part={p} mine={mine} />;
          case "story_reply":
            return <StoryReply key={i} part={p} media={media} />;
          case "template":
            return <Template key={i} part={p} mine={mine} />;
          case "share":
            return <Share key={i} part={p} media={media} />;
          case "voice":
            return <VoiceNote key={i} id={m.id} url={p.url} durationMs={media?.durationMs ?? p.durationMs} transcript={media?.transcript ?? null} mine={mine} />;
          case "image":
          case "video":
            return <Photo key={i} part={p} media={media} mine={mine} />;
          case "postback":
            return bubble(mine, p.title, i);
          case "reaction":
            return (
              <div key={i} className="os-th-note">
                Reacted {p.emoji}
              </div>
            );
          default:
            return (
              <div key={i} className="os-th-note" aria-label={partAria(p, media) || undefined}>
                {partLabel(p)}
              </div>
            );
        }
      })}
    </>
  );
}

/** The heart (or any emoji) pinned under a bubble. */
export function Reactions({ m }: { m: RichMessage }) {
  if (!m.reactions.length) return null;
  const r = m.reactions[0];
  const heart = r.emoji === "❤" || r.emoji === "❤️" || r.emoji === "love";
  return (
    <span className="os-th-react" aria-label={heart ? "Reacted with a heart" : `Reacted ${r.emoji}`} data-heart={heart || undefined}>
      {heart ? <Ico d={HEART} fill size={11} /> : r.emoji}
    </span>
  );
}
