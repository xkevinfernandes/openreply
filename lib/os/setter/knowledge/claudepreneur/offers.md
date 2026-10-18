---
# offers.md — which offers exist and which are OPEN right now. The setter only
# ever invites to an OPEN offer and never mentions a closed one.
#
# One `## ` section per offer. Key lines the loader reads (anything else is notes
# the setter also sees):
#   status:     open | closed | draft
#   open_from:  YYYY-MM-DD   (optional — offer opens that day)
#   open_until: YYYY-MM-DD   (optional — offer closes after that day, e.g. a 5-day micro-offer window)
#   sold_by:    call | doc | either   (how the invitation happens)
#   price:      what it costs                 price_in_dms: no | yes
#   length:     how long it runs
#   doc_url:    the offer doc (needed for sold_by doc/either)
#   payment_url: checkout link (optional)
# Change `status` or the dates and the next draft follows it. No code change.
---

## Case study offer
status: open
sold_by: call
price: 3.5k
price_in_dms: no
length: 6 months
doc_url:
payment_url:

Who it's for: tbd
What they get: tbd
Why it's a case study: tbd (Kevin: the angle in one or two lines, e.g. reduced price in exchange for results, a testimonial and permission to share the build)

## Micro offer
status: draft
sold_by: doc
price: tbd
price_in_dms: yes
length: tbd (Ollie's rule: 14 to 30 days, long enough to show how good you are, not long enough to get the full result)
open_from:
open_until:
doc_url:
payment_url:

What they get: tbd (the full core service minus anything that costs money to deliver, not a stripped-down low-ticket thing)
Ascension: midway, a personal Loom or call offering the core program, with the micro-offer price credited toward it.
