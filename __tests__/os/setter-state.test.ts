// Port of DM Setter/scripts/dms/test_state_lib.py: the behavioural spec for
// J's state machine. Every Python assert has its counterpart here, in order.
import { describe, expect, it } from "vitest";
import * as S from "../../lib/os/setter/state";
import type { SetterRecord, ThreadMessage } from "../../lib/os/setter/state";
import type { CatalogRow } from "../../lib/os/setter/types";

const CATALOG: CatalogRow[] = [
  {
    slug: "yt02",
    type: "resource",
    resource_url: "https://youtu.be/shZi3aes5Rg",
    match: ["youtu.be/shZi3aes5Rg"],
    triggers: [
      { surface: "comment", post_id: "p1", keyword: "video" },
      { surface: "story", post_id: null, keyword: "video" },
    ],
    zernio: {
      button_title: "send me the video",
      dm_message: "yo 👀 want the positioning video? tap below and I'll send it",
    },
    dm: { message: "here you go 🤝🏽 it's the one on why sold-out coaches aren't out-posting you", button: "watch it here" },
  },
  {
    slug: "talk",
    type: "setter",
    triggers: [{ surface: "dm", post_id: null, keyword: "setter" }],
    opener: { message: "hey, glad you reached out. what made you send that?" },
  },
  {
    slug: "lm",
    type: "setter",
    engine: "openreply",
    lead_magnet: "yt02",
    triggers: [{ surface: "comment", post_id: null, keyword: "leadtest" }],
    opener: { message: "hey! are you here for the AI DM setter workshop?" },
  },
];
const CFG = {
  timers: {
    value_opener_delay_minutes: 30,
    nudge_after_hours: 6,
    nudge_max: 1,
    offer_expires_days: 7,
    stale_days: 10,
    free_window_hours: 24,
    human_agent_days: 7,
    window_safety_minutes: 60,
  },
};

function msg(i: number, text: string, incoming: boolean, at: string, kw: Partial<ThreadMessage> = {}): ThreadMessage {
  return { id: `m${i}`, text, incoming, at, ...kw };
}

function run(msgs: ThreadMessage[], tags: string[], now: string, rec?: SetterRecord) {
  let r = rec ?? S.newRecord("c1", "sam");
  r = S.observe(r, msgs, tags, CATALOG, now, CFG);
  return S.advance(r, now, CFG);
}

describe("window", () => {
  it("follows Meta's 24h + 7d rules with the safety margin", () => {
    expect(S.windowState(null, "2026-09-14T12:00:00Z", CFG)[0]).toBe("closed");
    expect(S.windowState("2026-09-14T11:00:00Z", "2026-09-14T12:00:00Z", CFG)[0]).toBe("free");
    // 23h30 later: inside 24h but past the 60-min safety margin -> human_agent
    expect(S.windowState("2026-09-14T00:00:00Z", "2026-09-14T23:30:00Z", CFG)[0]).toBe("human_agent");
    expect(S.windowState("2026-09-01T00:00:00Z", "2026-09-14T00:00:00Z", CFG)[0]).toBe("closed");
    expect(S.windowState("2026-09-10T00:00:00Z", "2026-09-14T00:00:00Z", CFG)[0]).toBe("human_agent");
  });
});

describe("matching", () => {
  it("resolves our messages to catalog rows and spots trigger text", () => {
    expect(S.matchOutgoing("here you go 🤝🏽 it's the one on why sold-out coaches...", CATALOG)).toBe("yt02");
    expect(S.matchOutgoing("random text with a link https://youtu.be/shZi3aes5Rg", CATALOG)).toBe("yt02");
    expect(S.matchOutgoing("hey, glad you reached out. what made you send that?", CATALOG)).toBe("talk");
    expect(S.matchOutgoing("honestly good man, hbu?", CATALOG)).toBeNull();
    expect(S.isTriggerText("video", CATALOG)).toBe(true);
    expect(S.isTriggerText("Send me the video", CATALOG)).toBe(true);
    expect(S.isTriggerText("", CATALOG)).toBe(true);
    expect(S.isTriggerText("I run a coaching biz and it's stuck", CATALOG)).toBe(false);
  });
});

const offer = msg(1, "yo 👀 want the positioning video? tap below and I'll send it\n[button: send me the video -> yt02]", false, "2026-09-14T10:00:00Z");
const tap = msg(2, "send me the video\n[they tapped: send me the video]", true, "2026-09-14T10:05:00Z", { postback: true });
const deliver = msg(
  3,
  "here you go 🤝🏽 it's the one on why sold-out coaches aren't out-posting you\n[button: watch it here -> https://youtu.be/shZi3aes5Rg]",
  false,
  "2026-09-14T10:05:10Z"
);

describe("comment path", () => {
  it("no tap: offered, then unreachable after 8 days", () => {
    // Our private reply is the only message. No incoming => closed window => offered.
    const [rec, act] = run([offer], [], "2026-09-14T11:00:00Z");
    expect(rec.entry?.via).toBe("post_keyword");
    expect(rec.entry?.slug).toBe("yt02");
    expect(rec.state).toBe("offered");
    expect(act).toBeNull();
    const [rec2, act2] = run([offer], [], "2026-09-22T11:00:00Z", rec);
    expect(rec2.state).toBe("unreachable");
    expect(act2).toBeNull();
  });

  it("tap -> deliver -> value opener -> nudge -> reply", () => {
    let [rec, act] = run([offer, tap, deliver], ["sent:yt02"], "2026-09-14T10:20:00Z");
    expect(rec.their_last_at).toBe("2026-09-14T10:05:00Z"); // a tap counts as their message
    expect(rec.delivered_at).toBe("2026-09-14T10:05:10Z");
    expect(rec.window.state).toBe("free");
    expect(rec.state).toBe("delivered"); // 15 min < 30
    expect(act).toBeNull();
    expect(rec.next_action.kind).toBe("value_opener");
    [rec, act] = run([offer, tap, deliver], ["sent:yt02"], "2026-09-14T10:40:00Z", rec);
    expect(act?.kind).toBe("value_opener");
    expect(act?.human_agent).toBe(false);

    // opener sent -> quiet 6h -> nudge (still free window: 10:05 + 23h)
    const opener = msg(4, "did you get to watch it? curious what you're building", false, "2026-09-14T10:45:00Z");
    [rec, act] = run([offer, tap, deliver, opener], ["sent:yt02"], "2026-09-14T14:00:00Z", rec);
    expect(rec.opener_sent_at).toBe("2026-09-14T10:45:00Z");
    expect(act).toBeNull();
    expect(rec.next_action.kind).toBe("nudge");
    [rec, act] = run([offer, tap, deliver, opener], ["sent:yt02"], "2026-09-14T17:00:00Z", rec);
    expect(act?.kind).toBe("nudge");
    expect(act?.human_agent).toBe(false);
    // past 24h since the tap -> the same nudge needs HUMAN_AGENT
    const [, actHa] = run([offer, tap, deliver, opener], ["sent:yt02"], "2026-09-15T12:00:00Z", rec);
    expect(actHa?.kind).toBe("nudge");
    expect(actHa?.human_agent).toBe(true);
    // after the nudge was sent (nudges=1), nothing more; >10d quiet -> not_now
    let recN: SetterRecord = { ...rec, nudges: 1 };
    const nudge = msg(5, "no stress if not, just lmk", false, "2026-09-14T17:05:00Z");
    const [recN2, actN] = run([offer, tap, deliver, opener, nudge], ["sent:yt02"], "2026-09-15T12:00:00Z", recN);
    expect(actN).toBeNull();
    recN = recN2;
    [recN] = run([offer, tap, deliver, opener, nudge], ["sent:yt02"], "2026-09-26T12:00:00Z", recN);
    expect(recN.state).toBe("not_now");

    // they reply to the opener -> reply draft, in_conversation
    const reply = msg(6, "yeah watched it, I run a coaching biz and it's stuck at 5k", true, "2026-09-14T11:30:00Z");
    [rec, act] = run([offer, tap, deliver, opener, reply], ["sent:yt02"], "2026-09-14T11:35:00Z", rec);
    expect(rec.state).toBe("in_conversation");
    expect(act?.kind).toBe("reply");
    expect(act?.anchor).toBe("m6");
    // we replied last again -> no reply action, nudge timer pending
    const ours = msg(7, "5k is a real base tho. what's capping it rn?", false, "2026-09-14T11:40:00Z");
    [rec, act] = run([offer, tap, deliver, opener, reply, ours], ["sent:yt02"], "2026-09-14T11:45:00Z", rec);
    expect(act).toBeNull();
    expect(rec.next_action.kind).toBe("nudge");
  });
});

describe("story path", () => {
  it("story keyword reply gets the resource, then a value opener", () => {
    const story = msg(1, "video\n[replying to your story]", true, "2026-09-14T09:00:00Z", { story_reply: true });
    const sdeliver = { ...deliver, id: "m2", at: "2026-09-14T09:00:10Z" };
    let [rec, act] = run([story, sdeliver], [], "2026-09-14T09:10:00Z");
    expect(rec.entry?.via).toBe("story_keyword");
    expect(rec.entry?.slug).toBe("yt02");
    expect(rec.state).toBe("delivered");
    expect(act).toBeNull();
    [rec, act] = run([story, sdeliver], [], "2026-09-14T09:45:00Z", rec);
    expect(act?.kind).toBe("value_opener");
  });
});

describe("setter keyword", () => {
  it("waits for their answer to the opener, then replies", () => {
    const kw = msg(1, "setter", true, "2026-09-14T09:00:00Z");
    const op = msg(2, "hey, glad you reached out. what made you send that?", false, "2026-09-14T09:00:05Z");
    let [rec, act] = run([kw, op], [], "2026-09-14T09:30:00Z");
    expect(rec.entry?.via).toBe("setter_keyword");
    expect(rec.state).toBe("setter_open");
    expect(act).toBeNull();
    const answer = msg(3, "saw your reel on agents, I'm trying to automate my onboarding", true, "2026-09-14T09:40:00Z");
    [rec, act] = run([kw, op, answer], [], "2026-09-14T09:41:00Z", rec);
    expect(act?.kind).toBe("reply");
    expect(rec.state).toBe("in_conversation");
  });
});

describe("comment → setter (OpenReply opener)", () => {
  const lop = msg(1, "hey! are you here for the AI DM setter workshop?", false, "2026-10-18T10:00:00Z");
  const yes = msg(2, "yes", true, "2026-10-18T10:01:00Z");

  it("treats their first reply as the answer, and J sending the lead magnet stays on the setter path", () => {
    let [rec, act] = run([lop], [], "2026-10-18T10:00:30Z");
    expect(rec.entry?.via).toBe("setter_comment");
    expect(rec.entry?.slug).toBe("lm");
    expect(rec.entry?.at).toBe("2026-10-18T10:00:00Z");
    expect(rec.state).toBe("offered");
    expect(act).toBeNull();
    const [rec2] = run([lop], [], "2026-10-26T10:00:30Z", rec);
    expect(rec2.state).toBe("unreachable");
    [rec, act] = run([lop, yes], [], "2026-10-18T10:01:10Z", rec);
    expect(act?.kind).toBe("reply");
    expect(act?.anchor).toBe("m2");
    expect(rec.state).toBe("in_conversation");
    // a fresh record that only ever sees both messages lands in the same place
    [rec, act] = run([lop, yes], [], "2026-10-18T10:01:10Z");
    expect(rec.entry?.via).toBe("setter_comment");
    expect(act?.kind).toBe("reply");
    // J sending the lead magnet later does not flip this into the resource path (no value_opener timer)
    const ask = msg(3, "before I send it over, do you mind if I ask a couple quick questions?", false, "2026-10-18T10:02:00Z");
    const ok = msg(4, "sure go ahead", true, "2026-10-18T10:03:00Z");
    const link = msg(5, "here you go https://youtu.be/shZi3aes5Rg", false, "2026-10-18T10:20:00Z");
    [rec, act] = run([lop, yes, ask, ok, link], [], "2026-10-18T11:00:00Z", rec);
    expect(rec.entry?.via).toBe("setter_comment");
    expect(rec.resources_sent).toContain("yt02");
    expect(act === null || act.kind === "nudge").toBe(true);
  });

  it("an old thread gets a fresh OpenReply opener and re-enters once", () => {
    const oldop = msg(1, "yo 👀 want the positioning video? tap below and I'll send it", false, "2026-08-21T16:14:48Z");
    const oldin = msg(2, "[they tapped: send me the video]", true, "2026-08-21T16:15:00Z", { postback: true });
    let [rec] = run([oldop, oldin], [], "2026-08-22T10:00:00Z");
    expect(rec.entry?.via).toBe("post_keyword");
    const lop2 = msg(3, "hey! are you here for the AI DM setter workshop?", false, "2026-10-18T10:00:00Z");
    const yes2 = msg(4, "yes", true, "2026-10-18T10:01:00Z");
    const [rec4, act] = run([oldop, oldin, lop2, yes2], [], "2026-10-18T10:01:10Z", rec);
    rec = rec4;
    expect(rec.entry?.via).toBe("setter_comment");
    expect(rec.entry?.at).toBe("2026-10-18T10:00:00Z");
    expect(act?.kind).toBe("reply");
    expect(act?.anchor).toBe("m4");
    [rec] = run([oldop, oldin, lop2, yes2], [], "2026-10-18T10:02:00Z", rec);
    expect(rec.history.filter((h) => h.event.startsWith("re-entry:setter_comment")).length).toBe(1);
  });
});

describe("email gate answers", () => {
  it("recognises a bare email as a gate answer, not something to reply to", () => {
    expect(S.isEmailOnly("Sam@Example.com")).toBe(true);
    expect(S.isEmailOnly("sure! it's sam@x.io.")).toBe(true);
    expect(S.isEmailOnly("sam@x.io but what is this for?")).toBe(false);
    expect(S.isEmailOnly("no email sorry")).toBe(false);
    const gop = msg(1, "yo 👀 want the positioning video? tap below and I'll send it", false, "2026-10-18T10:00:00Z");
    const gask = msg(2, "what's the best email to send it to?", false, "2026-10-18T10:00:30Z");
    const gans = msg(3, "sam@example.com", true, "2026-10-18T10:01:00Z");
    const [rec, act] = run([gop, gask, gans], [], "2026-10-18T10:01:30Z");
    expect(rec.email).toBe("sam@example.com");
    expect(rec.last_incoming_text_id).toBeNull();
    expect(act === null || act.kind !== "reply").toBe(true);
  });
});

describe("cold DM + tags", () => {
  it("replies to a cold DM; freeze/booked tags stop J; sent/clicked tags fold in", () => {
    const cold = msg(1, "hey man love the content, how do you build these agents?", true, "2026-09-14T09:00:00Z");
    let [rec, act] = run([cold], [], "2026-09-14T09:05:00Z");
    expect(rec.entry?.via).toBe("cold_dm");
    expect(act?.kind).toBe("reply");
    [rec, act] = run([cold], ["friend"], "2026-09-14T09:05:00Z");
    expect(rec.state).toBe("frozen");
    expect(act).toBeNull();
    [rec, act] = run([cold], ["booked"], "2026-09-14T09:05:00Z");
    expect(rec.state).toBe("booked");
    expect(act).toBeNull();
    [rec, act] = run([cold], ["clicked:yt02", "sent:yt02"], "2026-09-14T09:05:00Z");
    expect(rec.clicked).toEqual(["yt02"]);
    expect(rec.resources_sent).toEqual(["yt02"]);
  });
});

describe("re-entry (Kevin's sandbox run, 2026-09-14)", () => {
  it("a not-now cold thread re-enters on the setter keyword; the old 'hey' is no answer", () => {
    // "hey man" → triaged not now → later DMs "setter" → Zernio opener → answers: the setter must take it.
    const hey = msg(1, "hey man", true, "2026-09-14T20:51:00Z");
    let [rec, act] = run([hey], ["not_now_auto"], "2026-09-14T20:51:10Z", { ...S.newRecord("c9", "lead"), triaged_msg_id: "m1" });
    expect(rec.entry?.via).toBe("cold_dm");
    expect(rec.state).toBe("not_now");
    expect(act).toBeNull();
    const kw2 = msg(2, "setter", true, "2026-09-14T20:52:00Z");
    const op2 = msg(3, "hey, glad you reached out. what made you send that?", false, "2026-09-14T20:52:05Z");
    [rec, act] = run([hey, kw2, op2], ["not_now_auto"], "2026-09-14T20:52:10Z", rec);
    expect(rec.entry?.via).toBe("setter_keyword");
    expect(rec.entry?.at).toBe("2026-09-14T20:52:00Z");
    expect(rec.state).toBe("setter_open"); // the old "hey man" is not an answer
    expect(act).toBeNull();
    const ans = msg(4, "curious about what you got to offer", true, "2026-09-14T20:53:00Z");
    [rec, act] = run([hey, kw2, op2, ans], ["not_now_auto"], "2026-09-14T20:53:10Z", rec);
    expect(act?.kind).toBe("reply");
    expect(act?.anchor).toBe("m4");
    expect(rec.state).toBe("in_conversation");
    // the same keyword message seen again on the next pass does not re-enter
    const [rec2] = run([hey, kw2, op2, ans], ["not_now_auto"], "2026-09-14T20:54:00Z", rec);
    expect(rec2.history.filter((h) => h.event.startsWith("re-entry")).length).toBe(1);
    // a Kevin-ticked not_now stays permanent even through a keyword
    const [rec3, act3] = run([hey, kw2, op2, ans], ["not_now"], "2026-09-14T20:53:10Z");
    expect(rec3.state).toBe("not_now");
    expect(act3).toBeNull();

    // projection is flat
    const proj = S.projection(rec);
    expect(proj.state).toBeTruthy();
    expect(Array.isArray(proj.resources_sent)).toBe(true);
    expect(Object.values(proj).every((v) => v === null || typeof v !== "object" || Array.isArray(v))).toBe(true);
  });
});

describe("after a send (setter_local._record_send)", () => {
  it("counts a nudge and stops nudging", () => {
    const opener = msg(4, "did you get to watch it? curious what you're building", false, "2026-09-14T10:45:00Z");
    let [rec, act] = run([offer, tap, deliver, opener], ["sent:yt02"], "2026-09-14T17:00:00Z");
    expect(act?.kind).toBe("nudge");
    rec = S.recordSend(rec, "nudge", ["no stress if not"], false, false, "2026-09-14T17:01:00Z");
    expect(rec.nudges).toBe(1);
    const sent = msg(5, "no stress if not", false, "2026-09-14T17:01:00Z");
    [rec, act] = run([offer, tap, deliver, opener, sent], ["sent:yt02"], "2026-09-15T02:00:00Z", rec);
    expect(act).toBeNull();
  });

  it("a skipped reply anchor is held until they write again", () => {
    const cold = msg(1, "hey man love the content, how do you build these agents?", true, "2026-09-14T09:00:00Z");
    let [rec, act] = run([cold], [], "2026-09-14T09:05:00Z");
    rec = S.recordSkip(rec, act!.anchor, "skipped:reply", "2026-09-14T09:06:00Z");
    [rec, act] = run([cold], [], "2026-09-14T09:07:00Z", rec);
    expect(act).toBeNull();
    const more = msg(2, "like what stack do you use", true, "2026-09-14T09:10:00Z");
    [, act] = run([cold, more], [], "2026-09-14T09:11:00Z", rec);
    expect(act?.anchor).toBe("m2");
  });
});
