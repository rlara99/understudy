# Understudy

Hack-Nation 7th Global AI Hackathon, Challenge 01 "The AI Apprentice" (ElevenLabs). Team: Renzo (voice agents, prompts, server, pitch) and Pablo (ERP, recording, screens, data). Repo: github.com/rlara99/understudy (private). Public overview: `README.md`. Original concept and build plan: `docs/concept-deck.html`, `docs/build-split.html`.

An AI apprentice that captures an expert's judgment while they work (Capture), turns it into a Work Map (Map), coaches new hires on unseen cases (Teach), and sends questions it can't answer back to the right expert (the **Gap Loop**, our differentiator).

## Status (end of build day)

All three required modules and the Gap Loop work end to end and were tested live:

| Piece | State |
|---|---|
| Capture | Works. Claudia asks at task completion (save or switching invoice), judges ask vs. acknowledge, reacts briefly to answers. |
| Map + debrief | Works. Finish task → draft map + gaps (~15–30 s) → spoken debrief (3–5 questions, teach-back, capped at 3:30) → Confirm. |
| Teach | Works. Blocked save of INV-5102 as opex → clip plays → predict-then-explain. Mastery panel in the ERP. |
| Gap Loop | Works. USD invoice flagged → routed to Marta → voice Quick Ask in Expert Minute → Work Map patched → badge clears. Duplicates merge ("asked by N"). |
| Trust | Personal fields blurred; Off the record (ERP button, panel button, or spoken) pauses recording, events, mic and transcript. |
| README | Done. |

**Still to do:** clean full run after **Reset demo** (also the first end-to-end test of the 3:30 debrief), backup demo video (Pablo), pitch slides with the 5 Apprentice Test answers and a moonshot slide. Optional stretch: "Export for agents" (Work Map → agent instructions).

## Desktop app (in progress)

Electron app in this repo (`desktop/`), wrapping the same React app and server. Two modes, three modules each:

| Mode | Module | What it does | Built from | Owner |
|---|---|---|---|---|
| Expert | **Work mode: live** | Claudia watches any app (vision frames) or the ERP (exact events), asks at the right moments; off the record | Apprentice panel capture + `/api/frame` | Renzo |
| Expert | **Work mode: record and learn** | Silent: records screen + mic + (opt-in) call audio, transcribes, no questions | Recorder + ElevenLabs speech-to-text | Renzo |
| Expert | **Debrief and teach** | 5-minute spoken debrief over the day's recordings → confirmed Work Map | Debrief flow, multi-session `/api/map` | Renzo |
| Expert | **Expert Minute** | Answer learners' open questions by voice | Inbox + Quick Ask | Pablo (UI), Renzo (voice) |
| Learner | **Assistant** | Live tips while working; learner can ask anything; unknowns become gap questions | Tutor panel | Renzo |
| Learner | **Knowledge Repository** | Tasks with walkthrough videos (step clips in sequence) | Library + Work Map + ClipPlayer | Pablo |
| Learner | **Expert Minute** | My questions + status/answers; submit a new question | Open questions + `POST /api/questions` | Pablo (UI), Renzo (route) |

- Shell: left sidebar with an Expert/Learner switch and the three modules of each mode; simple, modern (Pablo). Builds and runs in the browser at :5173 too; Electron just loads it.
- **The ERP is NOT part of Understudy.** It is a separate work app (owned and built by Pablo) that the expert/learner uses in a normal browser, like a real SAP/Excel. Understudy's nav has no ERP. The ERP talks to Understudy only through the API relay (below), so it can live on its own page, port or project.
- **Relay between apps** (`server/routes/relay.ts`, `src/shared/relay.ts`, Renzo): `POST /api/relay/:channel` delivers a JSON message to every listener of `GET /api/relay/:channel` (Server-Sent Events). `publish(channel, msg)` / `subscribe(channel, fn)` in `src/shared/relay.ts`. CORS allows any `http://localhost:*` origin; an app on another port sets `VITE_API_BASE=http://localhost:8787`. Tested direct and through the Vite proxy.
  - Channel `erp`: `publishErpEvent` / `onErpEvent` in `src/shared/bus.ts` now use the relay (same API as before, no caller changes).
  - Channel for capture control (off the record sync): `src/capture/control.ts` still uses BroadcastChannel and must move to `publish`/`subscribe` (Pablo, a 2-line swap) so the separate ERP's Off-the-record button keeps working.
- Electron (`desktop/`, Renzo): `main.cjs` opens the main window + a small always-on-top **companion** window for live sessions (Claudia status, mic, off the record) so people can work in other apps. Screen capture via `setDisplayMediaRequestHandler` (primary screen) with Windows `loopback` system audio when the page requests audio (call audio, opt-in). `preload.cjs` exposes `window.understudy` (`isDesktop`, `openCompanion(route)`, `closeCompanion()`, `focusMain()`). Use `openSession(route)` / `closeSession()` from `src/shared/desktop.ts` (falls back to same-tab navigation in a browser). Session routes: `work/live`, `work/record`, `learner/assistant`.
- Run the desktop app: `npm run desktop` (Vite + API + Electron; Vite has `strictPort: true` because Electron loads :5173). `npm run dev` still runs the web version only. Kill leftover node/electron processes if :5173 is taken.
- Needs `ELEVENLABS_API_KEY` in `.env` (server-side, Speech to Text) for record-and-learn transcription.

**Pablo, next:** pull; build the ERP as its own app (own entry/page, not in Understudy's nav), sending events with `publishErpEvent`; swap `control.ts` to the relay; build the shell, Knowledge Repository and both Expert Minute screens, starting sessions with `openSession(...)`.

## Run

```
npm install
cp .env.example .env   # ANTHROPIC_API_KEY = Parley key, ANTHROPIC_BASE_URL=https://parley.api.mit.edu
npm run dev            # web http://localhost:5173, API :8787 (8787 has no page: "Cannot GET /" is normal)
npm run typecheck
```

Restart `npm run dev` after changing any `.env*` file. Only one copy can run (ports 5173/8787).

## Demo flow

| Role | Tabs | Steps |
|---|---|---|
| Expert (Sabrina) | `/#/erp` + `/#/panel` | Start capture (share the ERP tab) → INV-4471 cost center 4711→0400, INV-4472 approval → second, INV-4473 status → held, saving each → Finish task → Start debrief → Confirm Work Map |
| New hire (Lena) | `/#/erp/teach` + `/#/tutor` | Start tutor → INV-5102 saved as opex gets blocked → fix to 0400 + asset no. → INV-5103 (USD): "Sabrina never showed me this" → flagged |
| Other expert (Marta) | `/#/inbox` | Start voice session → Start Quick Ask → answer → "that's saved" |
| Anyone | `/#/library` | Coverage, mastery, open-question badges. **Reset demo** restores seed data. |

Routes (`src/App.tsx`): `#/erp` (expert), `#/erp/teach` (new hire), `#/panel`, `#/tutor`, `#/library`, `#/inbox`, `#/map/<workmap id>`.

## Who owns what

Only edit files you own; change shared files together and push right away.

| Path | Owner |
|---|---|
| `server/**`, `src/agents/**`, `src/panel/**` | Renzo |
| `src/erp/**`, `src/capture/**`, `src/screens/**`, `data/invoices.json`, `data/experts.json`, `data/seed/**` | Pablo |
| `src/shared/**`, `src/App.tsx`, `src/styles.css`, `CLAUDE.md`, `README.md` | Shared |

Git: `git pull` before starting, commit small, work on `main`. Generated session Work Maps (`data/workmaps/session-*.json`) and session logs are gitignored. Local test runs also modify `data/workmaps/sample-invoice-processing.json`: don't commit that; **Reset demo** restores it.

## Architecture

- **ERP → panels:** the ERP publishes `ErpEvent`s over BroadcastChannel `"erp"` (`src/shared/bus.ts`). `field_change` fires on blur/select, `keystroke` is throttled, `save` and `guardrail_blocked` on Save. No events while off the record.
- **Apprentice panel** (`src/panel/ApprenticePanel.tsx`): phases capture → mapping → ready → debrief → confirming → done, plus quickask → patching → qadone (opened from the inbox via `src/screens/quickAsk.ts`). The screen recording start is the session's zero point (event `t` = ms since recording start, matching the video).
- **Tutor panel** (`src/panel/TutorPanel.tsx`): loads the newest confirmed real map (sample as fallback), sends it as `[WORKMAP]`, shows the expert's clip on a blocked save, flags gaps.
- **Work Map:** steps (moment, decision, reason in the expert's words), guardrails with machine `check` rules (`violatedGuardrails()` in `src/shared/guardrails.ts`), open_questions, confirmed.
- **Recording:** `MediaRecorder` → IndexedDB (`src/capture/recordings.ts`). `ClipPlayer` plays 3 s before to 10 s after a moment, 30 s max. Off-the-record spans are cut from the recording.
- **Storage:** JSON files in `data/` via `server/store.ts`. The sample map `data/workmaps/sample-invoice-processing.json` has a pristine copy in `data/seed/`: **if you edit the sample, copy it to `data/seed/` too**, because Reset demo restores it from there.

## Pablo's side: how it works and how to hook in

### ERP (`src/erp/ErpPage.tsx`)
- Loads invoices from `/api/invoices` (filtered by `phase`). Edits persist in localStorage per mode until Reset demo.
- Events it publishes (`t = Date.now()`):
  - `invoice_opened` when an invoice is clicked.
  - `field_change`: selects (cost center, approval, status) fire immediately; text fields (asset no., note) fire **once on blur**, not per keystroke.
  - `keystroke`: at most one per field per second, field name only, never the text.
  - `save` with `field: "status", from, to`. Saving an "open" invoice posts it.
  - `guardrail_blocked` (teach mode only) with `field = guardrail id` and `note = guardrail text`.
- Teach mode picks its Work Map with the same rule as the tutor: newest confirmed non-sample map, else newest non-sample, else the sample. It reloads the map on window focus so a Gap Loop patch applies without a refresh.
- Capture mode never blocks a save.

### Capture (`src/capture/`)
- `useScreenRecorder()`: `start(sessionId)` opens the screen picker and returns the start time (use it as the session zero point); `stop()` resolves once the recording is stored. Also `offRecord`, `setOffRecord(on)`, `offRecordSpans()`, `grabFrame()` (null while off the record).
- Recordings live in **IndexedDB** in the browser (`recordings.ts`), keyed by session id, with their off-the-record spans. No server route; any tab on localhost:5173 can replay them. Clearing site data deletes them.
- `<ClipPlayer at={clip_s} sessionId? />`: plays from 3 s before to 10 s after (max 30 s). Falls back to the newest recording if the session has none. Maps session time to video time around off-record spans (the paused footage is not in the file).
- **Off the record**: the ERP shows a floating button while a recording runs. It talks to the recorder over BroadcastChannel `"understudy-capture"` (`control.ts`: `state`, `request`, `ping`). While off: the recorder is paused (no footage), the ERP publishes **no events**, and the ERP shows a striped banner.

### Screens (`src/screens/`)
- **Work Map** (`#/map/<id>`): step timeline; click a step to see its clip, decision, reason and guardrails. Reloads on focus.
- **Library** (`#/library`): one card per map with counts, new-hire mastery and an open-question badge; polls every 3 s. Two static stub cards. **Reset demo** button lives here.
- **Expert Minute** (`#/inbox`): open questions sorted by `asked_by_count`. "Start voice session" → `setPendingQuickAsk()` + opens `#/panel` (the panel reads it with `takePendingQuickAsk()` from `quickAsk.ts`). "Answer in text" POSTs `/api/patch` directly (cut-list fallback).
- **Mastery panel** (shown in `#/erp/teach`): `progress.ts` records blocked guardrails and saved invoices in localStorage. A step is "practice next" if any of its guardrails blocked a save, "mastered" if a saved invoice fell under one of its guardrails with no block.
- **Reset demo** (`resetDemo.ts`): clears ERP edits, mastery progress, pending Quick Ask and recordings, and PUTs the sample map back from `data/seed/`. It does **not** delete Work Maps made by capture sessions: before the real demo, delete old ones from `data/workmaps/` (keep the sample) so the ERP and tutor don't teach from a rehearsal map.

### Styles
- `src/styles.css` (shared) holds the design tokens: Inter, `--accent` indigo, `--ok/--warn/--bad` (+ `-soft`), `--radius`, `--shadow`, `--ring`, `--page-pad`. Use the tokens instead of hex colors.
- The ERP root is `.erp-app` (own look in `src/erp/erp.css`); screens use `src/screens/screens.css` (`.pill`, `.meter`, `button.primary`, `button.quiet`, `mark.gr`).

### API (`server/`)

- `GET /api/invoices`, `/api/experts`, `/api/workmaps`; `GET|PUT /api/workmaps/:id`, `/api/sessions/:id`
- `POST /api/map` `{ sessionId, workflow, expert, team, confirm?, debriefStartedAt? }` → `{ map, gaps }`. First call drafts; `confirm: true` folds debrief answers in and marks confirmed. Ignores off-record spans.
- `POST /api/route` `{ question, context?, open? }` → `{ expert_name, reason, neutral_question, duplicate_of }`. Short, general question; duplicate detection.
- `POST /api/patch` `{ workmapId, questionId, answer, expert }` → map with a new step and guardrails; stores a cleaned `answer_clean` built from the confirmed repeat-back.
- `POST /api/frame` (vision frames, optional, unused in the demo).

Claude goes through **MIT Parley** (Anthropic-compatible; the key does NOT start with `sk-ant-`). `server/env.ts` loads `.env` with override so a shell-level `ANTHROPIC_BASE_URL` can't win. Models: `claude-opus-5-5` (map, route, patch), `claude-haiku-4-5` (frames); override via `MAP_MODEL` / `FRAME_MODEL`. Structured outputs via `client.messages.parse` + zod (`server/claude.ts`).

## ElevenLabs

- Two agents (Creator plan): Interviewer `agent_4001m41j8r97eqks9k6y6nk8x05p`, Tutor `agent_1201m41qmexxet890wg5vmqqzsgb`. IDs are committed in `.env.development` (public by nature).
- Both are named **Claudia** (`AGENT_NAME`); the expert persona is **Sabrina**. Prompts and first messages live in `src/agents/prompts.ts` and are sent as **session overrides**: edit the code, not the dashboard. Each agent needs System prompt + First message overrides enabled in its Security tab. Interviewer has the Skip turn system tool on.
- Dynamic variables: `agent_name`, `expert_name`, plus `mode` (live | debrief | quick_ask) for the Interviewer.
- App → agent message prefixes. `[SCREEN]`, `[WORKMAP]`, `[OFF RECORD]`, `[ON RECORD]` are silent context updates. `[TASK DONE]`, `[PAUSE]`, `[GAPS]`, `[WRAP UP]`, `[TIME UP]`, `[QUESTION]`, `[ADDRESSED]`, `[OPENED]`, `[BLOCKED]`, `[SAVED]` are user messages that trigger a reply.
- Timing (`src/agents/pauseRule.ts`): main trigger = task done; mid-task only important fields (cost_center, approval, status) after a 2.5 s pause; 8 s minimum gap; resend once if unanswered after 5 s.
- Mic: picker in both panels; mic muted while the agent speaks (half-duplex, against background noise) unless "Let me interrupt" is ticked; muted while off the record.

## Lessons / gotchas

- **Never call `sendUserActivity`** on keystrokes: it holds the agent ~2 s and silently swallowed our nudges.
- If the agent "goes silent" on nudges, check the Debug list in the panel first, then the agent's Call history and LLM setting in the dashboard.
- Gaps and guardrail checks: the map prompt must tell Claude to approximate checks with available fields (e.g. amount > 5000 EUR for "equipment"), otherwise the capex rule has no check and Teach can't catch the demo mistake.
- Voice answers are messy transcripts; the patch uses the agent's confirmed repeat-back to store a clean answer.
- Pablo's files use CRLF line endings; normalize before string-matching edits.
- Starting a terminal-panel tab from Claude can time out; starting `npm run dev` in the background from Bash works.

## Rules

- Keys only in `.env`. Never commit `.env` or paste keys in chat.
- Personal fields (IBAN, contact) render with class `pii` (blurred) and are never sent to Claude.
- Gap questions never reveal who asked.
- When you change how something works, update this file in the same commit so the other person's Claude picks it up.
