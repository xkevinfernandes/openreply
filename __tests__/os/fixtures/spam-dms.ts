// Spam heuristic fixtures (dm-crm issue 012). Written by the build worker,
// modelled on the GHL scam DMs in NOTES (blue badge + link) and on real lead
// messages. Kevin: add real scam DMs to `scams` (issue 015) and real lead or
// friend messages with links to `real`. Target: zero false positives, at
// least 8 of 10 scams caught.

/** Scam DMs: link + impersonation wording. */
export const scams: string[] = [
  "Congratulations! Your account has been selected for the blue badge. Activate your account here: https://meta-verified-badge.com/activate",
  "Meta Support Team: your page will be disabled within 24 hours due to a copyright infringement. Submit an appeal here: www.meta-appeal-center.com",
  "Hi, we are reaching out from Instagram Help Center. Your account violated our community guidelines. To avoid suspension, verify your identity: bit.ly/3igHelp",
  "🔵 You're eligible for the verification badge! Fill out the form within 48h: https://forms.gle/verifyNow2026",
  "Dear creator, your account is being restricted for trademark violation. File an appeal now at instagram-copyright.support/case/88123",
  "Get your blue tick today 💙 limited slots for creators with 1k+ followers. Apply here → https://bluetick-agency.xyz",
  "META BUSINESS SUPPORT: Activate your Meta Verified badge before it expires: http://metaverified-activation.site/login",
  "We detected unusual activity. Your profile will be permanently deleted unless you confirm your identity: https://1nstagram-security.com/confirm",
  "Hello! You have been approved to receive the verified badge. Complete the verification process at m3ta-verify.help/start",
  "Final notice from the Instagram Security team. Your account has been suspended. Appeal form: https://ig-appeal.online/form?id=5521",
  "Your page violated our policy on copyright. If you think this is a mistake, fill out an appeal: www.facebook-policy-review.info",
  "hey dear, meta-support here 👋 activate your badge now https://tinyurl.com/badge-activate",
];

/** Real lead and personal messages that contain links (never spam). */
export const real: string[] = [
  "here's my site www.mayabuilds.shop, it's mostly notion templates",
  "check out my page instagram.com/lena.fit, I post workouts daily",
  "booked! https://cal.com/kevin/strategy for thursday",
  "this is the reel I was talking about https://www.instagram.com/reel/C9xYz123/",
  "my calendly is calendly.com/jordan-ops if easier",
  "sent you the doc: https://docs.google.com/document/d/1abcXYZ/edit",
  "lol look at this https://youtu.be/dQw4w9WgXcQ",
  "I sell on etsy, etsy.com/shop/priyastudio, about 40 orders a week",
  "can you look at my landing page? https://samortega.co/coaching",
  "we use manychat right now but it's messy, here's our flow loom.com/share/abc123",
  "my podcast just hit 50 episodes 🎉 open.spotify.com/show/xyz",
  "dinner at 7? here's the place maps.app.goo.gl/AbC123",
  "the guide link you sent didn't work for me, https://kevinfernandes.me/guide gives a 404",
  "I'm verified on tiktok already lol tiktok.com/@nora.coaching",
  "I run Meta ads for my clients, results here: https://nora.coach/case-studies",
  "how much is the program? my store is at shopify.com/ava-creates",
  "my account got hacked last month so I'm on a new one now, old was instagram.com/chris.makes.old",
  "watched your video on youtube.com/@kevin, the one about setters",
  "Here's the payment receipt https://stripe.com/receipts/acct_123",
  "my newsletter is at chrisdoyle.substack.com if you're curious",
  "tried your template, here's my version notion.so/ava/inbox-template",
  "the support team at shopify was useless, they sent me to help.shopify.com/en and nothing",
  "joined your waitlist via kevinfernandes.me/waitlist 🙌",
  "how do I activate the template? I bought it on gumroad.com/l/dmscript",
];
