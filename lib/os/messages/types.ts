// The Instagram-style message model the thread renders and J reads.
// lib/os/messages/parse.ts builds it from a raw Zernio message; the shapes
// are the ones the 2026-10-19 spike saw (__tests__/os/fixtures/zernio-messages.json).
// Anything unknown degrades to an "unsupported" part with a short label
// ("Sent an attachment"), never an error.

export interface TemplateButton {
  title: string;
  /** url / open_url buttons. */
  url: string | null;
  /** postback buttons. */
  payload: string | null;
  kind: "url" | "postback";
}

export type MessagePart =
  | { type: "text"; text: string }
  /** A URL always gets its own bubble. */
  | { type: "link"; url: string; domain: string; title: string | null }
  /** They replied to (or we replied to) a story. The story card comes from
   *  Data OS by storyId / assetId; the CDN url expires within days. */
  | { type: "story_reply"; storyId: string | null; assetId: string | null; url: string | null; mention: boolean }
  /** Generic template (OpenReply/Zernio/ManyChat card), or a text message
   *  sent with buttons (Zernio metaInteractive). */
  | { type: "template"; image: string | null; title: string | null; subtitle: string | null; buttons: TemplateButton[] }
  /** A shared reel, post or story. caption is Instagram's title field. */
  | { type: "share"; kind: "reel" | "post" | "story"; mediaId: string | null; url: string | null; caption: string | null }
  | { type: "image"; url: string | null }
  | { type: "video"; url: string | null }
  | { type: "file"; url: string | null }
  /** Zernio gives no duration; MessageMedia may add it later. */
  | { type: "voice"; url: string | null; durationMs: number | null }
  /** A reaction as its own event. Zernio puts reactions on the message itself
   *  (RichMessage.reactions), so the parser never emits this; mock data and
   *  other providers may. */
  | { type: "reaction"; emoji: string; ofMessageId: string | null }
  /** They tapped a template button. */
  | { type: "postback"; title: string; payload: string | null }
  | { type: "unsupported"; label: string };

export interface MessageReaction {
  emoji: string;
  fromMe: boolean;
  at: string | null;
}

/** Who sent an outgoing message, as far as Zernio knows (its sentVia). */
export type MessageOrigin = "automation" | "api" | "human" | null;

export interface RichMessage {
  id: string;
  direction: "incoming" | "outgoing";
  fromMe: boolean;
  /** ISO time. */
  at: string | null;
  parts: MessagePart[];
  reactions: MessageReaction[];
  /** Outgoing only: when they read it (Zernio readAt). */
  seenAt: string | null;
  deliveryStatus: "sent" | "delivered" | "read" | null;
  origin: MessageOrigin;
  /** The OpenReply/Zernio automation that sent it, when known. */
  automationId: string | null;
  /** A setter (J, Nova) wrote it: an approved draft. Set from the caller's
   *  list of sent message ids; Zernio itself only says "api". */
  fromSetter: boolean;
  /** Reply-to: the message this one quotes. */
  quotedMessageId: string | null;
  deleted: boolean;
  edited: boolean;
  /** Zernio's endpoint for fresh CDN urls of this message's media. */
  refreshUrl: string | null;
}
