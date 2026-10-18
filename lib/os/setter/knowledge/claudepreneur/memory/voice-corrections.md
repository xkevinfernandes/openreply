---
# voice-corrections.md — the file learning loop.
# When you edit a draft before approving it, append a bullet here recording what
# the setter wrote vs your version. Every future reply reads this file and learns
# the PATTERN (tone, length, word choice) — so correcting the setter trains it,
# no code change. Keep the most instructive corrections; prune the rest.
#
# Format (one bullet per correction):
# - you wrote: 'the draft that was too long/off-voice'
#   my version: 'what I actually sent'
#   note: (optional) why
---

- you wrote: 'so would you be down for a quick call? no pitch, just want to see where you're at and if I can help'
  my version: 'want to jump on a quick call? just want to see where you're at and if I can help'
  note: never lower your frame — "would you be down" / "would you be opposed" is tentative and puts you below them. Ask casually and confidently like a peer inviting them: "want to jump on a quick call?"

<!-- migrated from docs/sp/dms/voice-corrections.md on 2026-09-14 -->

> The self-improving loop, ported from Jason's `memory/voice-corrections.md`.
> **Auto-appended** by `scripts/dms/log_correction.py` every time Kevin edits a J draft before sending
> (the diff between what J drafted and what Kevin actually sent = the highest-signal calibration data).
> **Distilled** by `scripts/dms/distill_corrections.py` into proposed rules (`proposed-rules.md`) for review.
>
> Kevin reviews proposed rules and folds the good ones into `DM Setter/Setting Script.md` (method) or `setters/default/voice.md` (voice). J never self-edits.
>
> Each entry: stage + context, what J drafted, what Kevin sent, and (after distill) the rule extracted.

<!-- corrections appended below this line -->

## Correction 1 — @newlead_test (2026-06-10)

- **stage:** value_curiosity · **template:** Stage 2 mid-conversation pivot (curiosity follow-up, coach/creator)
- **context (last inbound):** yeah through my podcast mainly

**J drafted:**

> oh nice, a podcast is honestly one of the best trust builders for a coach, people get hours with you before they ever book
> so where does the content automation piece come in for you.. are you trying to turn the podcast into the rest of your content, clips, posts, all that?

**Kevin sent:**

> oh nice, a podcast is one of the best trust builders for a coach, people get hours with you before they ever book
> so where does the content automation piece come in for you.. are you trying to turn the podcast into the rest of your content, clips, posts, all that?

**rules extracted:** _(pending distill)_

---

## Correction 2 — @ahmedelsaleet (2026-06-11)

- **stage:** stage_2_value_curiosity · **template:** Stage 2 generic flow (react + concrete insight + open question), adapted to their Zapier/onboarding question
- **context (last inbound):** Just wondering is Claude code on its own enough to replace zapier automations? 

Cause if it can do client onboarding and stuff like that on its own imma unsub from zapier and go all in on Claude

**J drafted:**

> ha appreciate that
> honestly yeah, I moved most of my zapier stuff over to claude code already.. it handles the judgment calls in onboarding that zapier always choked on, like reading what the client actually sent and deciding what happens next
> what does your onboarding flow look like right now?

**Kevin sent:**

> ha appreciate that
> honestly yeah, you could do that.. they are different tools but CC can def handle zapier automations + more, like reading what the client actually sent on the form and deciding what happens next (doing the work in advance for the client based on your processes asw)
> what does your onboarding flow look like right now?

**rules extracted:** _(pending distill)_

---

## Correction 3 — @ahmedelsaleet (2026-06-11) — Kevin overruled a partnership-route reframe

- **stage:** stage_3_permission · **template:** Stage 3 contextual permission ask
- **context:** lead flagged `offer_route: partnership_candidate` (likely DFY/profit-share, not the program). Given that context, J recommended reframing the reassurance bubble to avoid the teach-you track.

**J recommended (with partnership context):**

> and level 0 is honestly fine, depends what you're actually after.. most people just want the thing running, not to become the one running it

**Kevin kept the original:**

> and level 0 is actually fine, most of the founders I work with started exactly there

- **Kevin's reasoning:** Jason Cooperson also runs DFY offers and asks the same qualification questions — the "founders I work with started exactly there" social proof does NOT lock the conversation into the teaching track. No pre-steering before the bridge; the offer fork happens at the bridge/call, not in the qualification stages.
- **rule candidate:** an `offer_route` override changes the BRIDGE, not stages 1–4. Don't reframe earlier-stage copy to hedge for a future offer; keep the strongest social proof and qualify identically regardless of route.

**rules extracted:** _(pending distill)_

---

## Correction 4 — @ahmedelsaleet (2026-06-11) — pre-emptive objection ≠ early reveal

- **stage:** stage_4_qualify · **context (last inbound):** "Yes please ask away" + "I have to warn you though — I'm not interested in 1:1 mentorship as I am already investing a lot in my business right now… But I'm happy to hear more from you"
- Lead pre-emptively objected to the assumed offer before qualification. Kevin first considered revealing positioning ("I don't do 1:1 mentorship anyway, I mostly do partnership deals"), J drafted it on his direction — then Kevin reconsidered: "or we qualify him still, instead of making ourselves available?"

**Rejected (reveal variant):**

> ha love the honesty dude, so since we're on it..
> I don't really do 1:1 mentorship anyway, I mostly do partnership deals
> honestly it's way more fun to work WITH someone than for someone
> so no pressure on any of that, I'm just curious where you're at
> how many clients are you running through that flow right now?

**Chosen (qualify-first, final wording after a second round on bubble 1):**

> ha all good, I'm not here to sell you anything
> honestly just curious about the business.. how many clients are you running through that flow right now?

- **Reasoning (round 1 — reveal vs qualify):** revealing offer shape in response to a prospect's pre-emptive objection reshapes the offer around their resistance (reads as chasing) and shows the hand to an unqualified lead — if the numbers turn out weak, backing out is awkward; if strong, the reveal lands far harder at the bridge, earned and specific. The objection is a frame test: pass it with breezy indifference, then keep qualifying.
- **Reasoning (round 2 — which defusal wording):** Kevin flagged "I wasn't going to pitch you anything anyway" as defensive; also floated "my pitches are usually win-win". J's verdict: the tell between defending and frame-holding is **tense and target** — "wasn't going to pitch you" defends a *past intention* (answers an accusation he didn't quite make); "my pitches are usually win-win" engages the *future pitch* (confirms one is coming, guard stays up, pre-commits the hidden route, corporate register); bare "noted" is frame-perfect but too cold for a warm lead. Winner: a **present-tense identity statement** + immediate subject change — "I'm not here to sell you anything" states a posture rather than denying an intention, is literally true, conceals the route, and the very next line moves all attention to his business (indifference lives in the ATTENTION, not in coldness).
- **rule candidate (1):** when a lead pre-emptively objects to an assumed offer ("I won't buy X"), NEVER respond by revealing or reshaping what Kevin offers. One indifferent defusal bubble, then continue the stage's questions. Offer shape is revealed only at the bridge, after qualification justifies it.
- **rule candidate (2):** defusals must be present-tense posture statements ("I'm not here to sell you anything"), never past-tense denials ("I wasn't going to…") or future teases ("my pitches are…"), and must change the subject in the same send.

**rules extracted:** _(pending distill)_

---

## Correction 5 — @shaqirhussyin (2026-06-11)

- **stage:** value_curiosity · **template:** story-reply react + own-the-build casually + curiosity pivot (Kevin voice, adapted to claudepreneur)
- **context (last inbound):** Dashboard

**J drafted:**

> hey Shaqir! yeah that's the dm dashboard I built for my own inbox
> my AI setter drafts the replies and I just approve them, it's been a game changer honestly
> you running setters on your dms right now or still doing it yourself?

**Kevin sent:**

> hey Shaqir! I just realised that the text may give the impression that I send out the dashboard haha
> not currently production ready, this was more like a share the journey type of post man!
> I imagine you got setters in your biz?

**rules extracted:** _(pending distill)_

---

