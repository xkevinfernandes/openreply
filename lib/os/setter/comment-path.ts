// Port of the pure part of DM Setter/scripts/dms/comment_path.py: the comment
// → DM copy in Kevin's voice and the shape of a comment/story automation.
// The Python CLI around it (list posts, private-reply test sends, create /
// toggle Zernio automations, read logs) is not ported: keywords now live in
// OpenReply campaigns, managed from the Automations page (build step 6).

export const COMMENT_REPLY = "in your dm's 😎";
export const COMMENT_REPLY_VARIATIONS = ["just sent it 👀", "check your dm's 🤝🏽"];

/** The DM asks for the email directly: ONE call to action, no button. Their
 *  reply is what opens Meta's free 24h window. */
export const DM_MESSAGE = "yo! saw your comment 🤝🏽 what's the best email to send it to?";
export const DM_MESSAGE_VARIATIONS = [
  "hey! just saw your comment 👀 what's the best email to send this to?",
  "yo 🤝🏽 got you — what's the best email for it?",
];

/** "emailed you" / "sent" must not re-fire an email-capture automation. */
export const EXCLUDE_KEYWORDS = ["emailed", "sent"];

export interface CommentPathInput {
  keyword: string;
  story?: boolean;
  postId?: string | null;
  name?: string;
  matchMode?: "contains" | "word" | "exact";
  typoTolerance?: boolean;
  dmMessage?: string;
  dmVariations?: string[];
  commentReply?: string;
  commentReplyVariations?: string[];
  buttonTitle?: string;
  /** Link delivery: adds the url button + link tracking. Without it, the
   *  automation is the email-capture path. */
  buttonUrl?: string;
  clickTag?: string | null;
  activate?: boolean;
}

export interface CommentPathPlan {
  name: string;
  trigger: "comment" | "story_reply";
  platformPostId: string | null;
  keywords: string[];
  matchMode: "contains" | "word" | "exact";
  excludeKeywords: string[];
  typoTolerance: boolean;
  dmMessage: string;
  dmMessageVariations: string[];
  buttons: { type: "url"; title: string; url: string }[];
  commentReply: string | null;
  commentReplyVariations: string[] | null;
  linkTracking: boolean;
  clickTag: string | null;
  /** NEVER true: it collides with the DM keyword path. */
  alsoMatchInDms: false;
  isActive: boolean;
}

/** Two shapes: email capture (no button, ask for the email) and link delivery
 *  (one DM, one url button, link tracking). Same rules as cmd_create. */
export function commentPathPlan(input: CommentPathInput): CommentPathPlan {
  const trigger = input.story ? "story_reply" : "comment";
  const kw = input.keyword;
  const link = Boolean(input.buttonUrl);
  const buttons = link ? [{ type: "url" as const, title: input.buttonTitle || "here you go", url: input.buttonUrl! }] : [];
  const commentReply = input.commentReply || COMMENT_REPLY;
  const replyVariations = input.commentReplyVariations?.length
    ? input.commentReplyVariations
    : input.commentReply
      ? []
      : COMMENT_REPLY_VARIATIONS;
  return {
    name: input.name || (trigger === "comment" ? `COMMENT PATH · ${kw}` : `STORY PATH · ${kw}`),
    trigger,
    platformPostId: input.postId ?? null,
    keywords: [kw],
    matchMode: input.matchMode ?? "word",
    excludeKeywords: link ? [] : EXCLUDE_KEYWORDS,
    typoTolerance: Boolean(input.typoTolerance),
    dmMessage: input.dmMessage || DM_MESSAGE,
    dmMessageVariations: input.dmVariations?.length ? input.dmVariations : input.dmMessage ? [] : DM_MESSAGE_VARIATIONS,
    buttons,
    commentReply: trigger === "story_reply" ? null : commentReply,
    commentReplyVariations: trigger === "story_reply" ? null : replyVariations,
    linkTracking: buttons.length > 0,
    clickTag: input.clickTag ?? null,
    alsoMatchInDms: false,
    isActive: Boolean(input.activate),
  };
}
