# The AI console

A Stream Deck as the desk console for AI coding agents: what each session is doing, which agents and jobs are
healthy, and the keys to answer an agent that asks before it acts. The designs come from this fork owner's own
Stream Deck MK.2 console, a private daemon that has run on a desk for months. Here they are generic, themed Prism
Deck facets: they render in every theme, both modes and on every device, and they know nothing about any host,
service or daemon.

Like the rest of Prism Deck they are **visual**. A runtime sets their states (the plugin's per-key `state`
setting, a layout document, or a live channel), and a press cycles them by hand, the way `alert-build` works. The
permission keys show an answer; they do not send one to any agent.

## The keys (Apps › AI Console)

| Facet | What it shows | States (tone) | Params |
|---|---|---|---|
| `app-ai-thinking` | The orb that plays while AI work is in flight: a glass core breathing inside a spectral ring that turns. Done, the ring closes with a burst. | thinking (active), idle, done (ok) | `label`, `hue` |
| `app-ai-session` | One key per agent session: the project on top, the tool in use acted out in the middle (shell, edit, read, search, web, agent glyphs), what it is doing below. Waiting gets an amber ring that breathes. | tool (active), thinking, waiting (warn), idle, done (ok) | `project`, `tool`, `hue` |
| `app-ai-permission` | A pending permission prompt: the project, the tool that asks (`Bash`), "wants to", inside an amber ring that breathes at 1 Hz for 10 s and then holds. | asking (warn), allowed (ok), denied (neg) | `project`, `tool`, `verb` |
| `app-ai-allow` | ALLOW in a green ring. Hold it: a ring of light runs round the key; let go early and it says *hold longer*; hold through and it shows Allowed. | ready, rearmed (each press flips them) | `label`, `hold` (s) |
| `app-ai-deny` | DENY in a red ring, *press*; a press shows the lock and Denied for a moment. | none | `label` |
| `app-ai-screen` | SCREEN under a grey status tab, *answer there*: send the prompt back to the screen. | none | `label` |
| `app-ai-prompts` | Where permission prompts go: `auto` (to the deck once you have been away a while), `DECK` (always, in a violet ring) or `screen`. | auto, deck (active), screen (off) | `away` (min) |
| `app-ai-agent` | An agent or a scheduled job: a status tab in its state color, its name, its icon (or FAIL), when it last ran. | ok, running (busy), recovered (warn), failed (neg), off | `name`, `glyph`, `lastRun` (min) |
| `app-ai-page` | The page key of a console deck: PAGE 1/4 on a violet tab, the page name, a status line. | page-1 … page-8 (as many as `pages` lists) | `pages`, `status` |

Across several keys (also Apps › AI Console):

| Facet | Surface | What it shows |
|---|---|---|
| `app-ai-question` | span, 2 rows | An agent asks you something: the question flows word by word across the top row (each key holds its own lines, so no bezel cuts a word) and the answers wait on the row below, the first in green, the second in red, the rest in blue. A press on an answer lights it as *sent*. Params: `question`, `choices` (comma-separated), `from`. |
| `app-ai-stream` | span, 1 row | The work stream: packets of light colored by the Spectrum run along the row while an agent works, passing behind the bezels; idle, a few drift. States working / idle. |

## The moments (Spans)

| Facet | What it shows |
|---|---|
| `span-confetti` | A burst of Spectrum confetti when something finishes: it rains from the top edge, or bursts from the key you press. |
| `span-attention` | Rings of one tone spread from the middle key (or the key you press), three times, each key flashing as they pass: `warn` (amber) when an agent needs you, `neg` (red) when something breaks, `info` (blue). |
| `span-outrun` | An 80s neon drive as a screensaver: a striped sun on the horizon behind a ridge, a glowing grid floor rolling toward you. |

## The profiles

`scripts/build-iconpacks.mjs` writes two AI console profiles next to the samples (`plugin/dist/profiles/`), and the
website links them from `/deck/`. They need the plugin.

**Prism AI Console · Stream Deck MK.2** (5 × 3)

| Page | Row 0 | Row 1 | Row 2 |
|---|---|---|---|
| Console | three sessions (shell, thinking, idle), the thinking orb, prompt routing | Go to *Ask*, four agents (Build, Tests, Deploy, Review) | the permission prompt, Deny, Screen, an Alerts agent (failed), Allow |
| Ask | the question across rows 0 and 1 | | the work stream across four keys, Home |

**Prism AI Console · Stream Deck XL** (8 × 4): four sessions and the work stream on top, six agents with prompt
routing and the page key, the question across a 5 × 2 block beside the permission prompt and its Deny, Screen and
Allow keys; a second page plays the confetti across the whole deck.

The layouts are `AI_CONSOLE_LAYOUTS` in `src/export/profile.js` (`aiConsoleProfiles()` builds them); the sample
profiles and the profiles bundled in the plugin are unchanged.

## Tests

`test/ai-console.test.js` checks what each design promises (one look per session state and per tool, the hold
that cancels or allows, the breath that stops after ten seconds, the question flow that loses no word, a press that
changes only the answer row, confetti from the pressed key, the profiles); `test/facets.test.js` renders all of them
in every theme, mode and target within the frame budgets, like every facet.
