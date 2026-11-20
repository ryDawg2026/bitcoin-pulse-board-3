# Bitcoin Pulse Board 3
Condensed, fast view of the Pulse Board callers (Dash, Zippy, Mellow, Ripple, Sage, The Chief, Flippy) for Kalshi's 15-minute BTC up/down window.
Each caller shows only: avatar + name, direction, call time, its reasoning, and its all-time W–L (settled calls, scored by the engine against Kalshi settlement). A small strip shows the actual UP/DOWN result of the last 20 settled windows. **Paper picks only — no bets, no money, no keys.**

Calls come from `pulse3-engine` (Cloudflare Worker, own D1 `pulse3-engine-db`, cron every minute, 24/7) at
https://pulse3-engine.rydawg2026.workers.dev (`/calls`, `/health`, `/state`, `/history`). Caller logic (indicators.js, news.js, badges.js, callers.js)
is copied from Pulse Board 2 unchanged except the beat schedule, storage prefix `pulseboard3.`, and time wording. Fully separate from Pulse Board 2 and its engine.

Beats (min:sec into the window; settles at 15:00). 21 calls, 3 per Grokie, no shared times, all at least 30 s apart:
| Caller | Beats |
|---|---|
| Dash | 1:00 6:00 10:30 |
| Ripple | 2:00 9:00 12:30 |
| Mellow | 3:00 7:00 11:00 |
| Zippy | 4:00 8:00 11:30 |
| Sage (fixed) | 5:00 10:00 12:00 |
| The Chief | 5:30 9:30 13:00 |
| Flippy | 13:30 14:00 14:30 |

Each card shows all three calls of the window (latest reasoning open, earlier ones under "Why"). W–L counts every real call; Flippy's "no flip seen" and the Chief's "no clear read" are never losses.

Build: `python3 engine/build.py && node engine/avatars.mjs && python3 engine/mkpage.py` · local test: `cd engine && node test_calls.mjs`.
