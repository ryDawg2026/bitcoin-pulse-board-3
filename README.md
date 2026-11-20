# Bitcoin Pulse Board 3
Condensed, fast view of the Pulse Board callers (Dash, Zippy, Mellow, Ripple, Sage, The Chief, Flippy) for Kalshi's 15-minute BTC up/down window.
Each caller shows only: avatar + name, direction, call time, and its reasoning. **Paper picks only — no bets, no money, no keys.**

Calls come from `pulse3-engine` (Cloudflare Worker, own D1 `pulse3-engine-db`, cron every minute, 24/7) at
https://pulse3-engine.rydawg2026.workers.dev (`/calls`, `/health`, `/state`, `/history`). Caller logic (indicators.js, news.js, badges.js, callers.js)
is copied from Pulse Board 2 unchanged except the beat schedule, storage prefix `pulseboard3.`, and time wording. Fully separate from Pulse Board 2 and its engine.

Beats (min:sec into the window; settles at 15:00). Zippy and Sage fixed:
| Caller | Beats |
|---|---|
| Dash | 1:00 6:00 11:00 |
| Ripple | 2:00 9:30 13:30 |
| Mellow | 3:00 7:00 12:30 |
| Zippy (fixed) | 4:00 8:00 12:00 |
| Sage (fixed) | 5:00 10:00 13:00 |
| The Chief | 8:30 |
| Flippy | 14:30 |

Build: `python3 engine/build.py && node engine/avatars.mjs && python3 engine/mkpage.py` · local test: `cd engine && node test_calls.mjs`.
