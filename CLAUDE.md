# Understudy

Hack-Nation 7th Global AI Hackathon, Challenge 01 "The AI Apprentice" (ElevenLabs). Built by **Renzo Lara** (MIT Sloan): the whole app, from the voice agents, prompts, server and Claude pipeline to the Electron desktop app, the shell and screens, the ERP work app, capture, the live demo and the pitch videos. Repo: github.com/rlara99/understudy (private). Public overview: `README.md`. Original concept: `docs/concept-deck.html`.

An AI apprentice that captures an expert's judgment while they work, turns it into a Work Map, coaches new hires on cases the expert never showed, and sends questions it can't answer back to the right expert (the **Gap Loop**, our differentiator). It ships as a **Windows desktop app** (Electron) with two modes, Expert and Learner, plus a **separate ERP work app** in the browser.

## Start here (new Claude session)

- **Local checkout:** `C:\Users\renzo\understudy` (outside OneDrive on purpose). The hackathon notes/decks live in `...\OneDrive...\HackNation` (not the repo).
- **Open the app:** Start menu or desktop → **Understudy** (purple "U"). It runs `npm run desktop` hidden; closing the window stops everything. **Understudy (browser)** opens the same app in Chrome. The ERP opens from the sidebar's **Open the work app (ERP) ↗** (in the default browser).
- **Is it running?** ports 5173 (web) and 8787 (API) listening, and an Electron window titled "Understudy". Only one copy can run. If something is stuck: stop node/electron processes whose command line contains `understudy`, then relaunch from the icon. Logs: `%TEMP%\understudy.log` (desktop) / `%TEMP%\understudy-web.log` (browser).
- **After changing `desktop/main.cjs` or `preload.cjs`** the app must be restarted; everything in `src/` hot-reloads (Ctrl+R, or reopen the companion window). After changing `.env*`, restart too.
- **Keys:** `.env` (not committed) holds `ANTHROPIC_API_KEY` (an MIT **Parley** key, doesn't start with `sk-ant-`), `ANTHROPIC_BASE_URL=https://parley.api.mit.edu`, `ELEVENLABS_API_KEY` (Speech to Text only). Never print or commit them.
- **Working with Renzo:** keep answers brief and give numbered test steps with ✅ expectations; Renzo tests by voice in the desktop app and reports back. Check the app's state yourself (ports, logs, `data/`) before asking. Pull before work, commit small, push right away; typecheck (`npx tsc --noEmit`) before every commit. Test server routes on throwaway files in `data/` and delete them after. Renzo owns every file, so edit anything directly.

## Status (Oct 4): everything works end to end, tested live; submitted

| Piece | State |
|---|---|
| Expert › Work mode: live | Claudia asks at task completion (save / switching invoice / vision "task done"), judges ask vs. acknowledge, reacts briefly, stays quiet through silence. Sessions are **named**, can be **continued** (part 2, 3…). Off the record. |
| Expert › Work mode: record & learn | Screen + mic (+ opt-in call audio) → ElevenLabs Scribe v2 transcript. No questions. |
| Expert › Debrief & teach | Sessions grouped **by day**, one row per **name** (all parts) → draft Work Map + gaps → 5-minute spoken debrief → Confirm. **Rename** sessions and the draft map; **Select day**, **Delete selected (n)**, per-row Delete. |
| Expert › Expert Minute | Answer learners' questions by voice (Quick Ask) or text. Delete questions. |
| Learner › Assistant | Tips while working (ERP events + vision for any app), typed/spoken questions; unknowns flagged → routed to the right expert. Blocked save of INV-5102 as opex → clip + predict-then-explain. |
| Learner › Knowledge Repository | Tasks with walkthrough videos (step clips in order), mastery, delete task/step. |
| Learner › Expert Minute | My questions + status/answers, submit new, withdraw. |
| Gap Loop | Flagged → routed (Marta) → voice Quick Ask → map patched → badge clears. Duplicates merge ("asked by N"). |
| Trust | Personal fields blurred; Off the record (ERP button, panel button, or spoken) pauses recording, events, mic and transcript; delete anything. |
| Desktop | Electron main + always-on-top companion window; launch icons on desktop + Start menu; ERP link opens in the browser. |

**Done Oct 4 (Renzo):**
- Submission videos (team intro, product demo, technical walkthrough) built with ElevenLabs narration/music; files in the HackNation folder.
- **Live demo:** https://understudy-rl-ara.vercel.app, a read-only build of this app (Vercel project `understudy`, deployed from the `live-demo` branch: `VITE_DEMO=1`, static API snapshot in `public/demo/`, relay over BroadcastChannel, AI and voice show a "runs in the desktop app" note). Keep it off `main`.
- Bug fixes merged (`b86ca3c`): Expert Minute answers credited to the answering expert (`step.said_by`); no clips for quick-ask steps; Assistant clip uses `step.moment.session`; ERP dates in UTC; askers kept out of `/api/workmaps` and Claude; no extra vote on repeat asks; locked read-modify-write (`updateJson`); unmeetable guardrail checks dropped; one map rule for Assistant, ERP and questions (`src/shared/pickMap.ts`, `confirmed_at`); API on loopback only (`127.0.0.1:8787`, Vite proxy and launcher updated). Favicon added.

**Still to do (optional):**
1. Demo prep: delete rehearsal sessions/maps (Debrief & teach → Select day → Delete selected; Knowledge Repository → delete old tasks; keep the sample), **Reset demo**, one clean full run, record a backup video.
2. README update for the desktop app.
3. Optional: "Export for agents" (Work Map → agent instructions, a brief stretch goal); real installer (electron-builder, server bundled, data in the user folder, keys entered on first run).

## Modules

| Mode | Module | Shell route | Session route / component |
|---|---|---|---|
| Expert | Work mode: live | `#/expert/live` (launch card) | `work/live` → `WorkSession mode="live"` (companion) |
| Expert | Work mode: record & learn | `#/expert/record` | `work/record` → `WorkSession mode="record"` (companion) |
| Expert | Debrief & teach | `#/expert/debrief` | `DebriefModule` (inside the shell) |
| Expert | Expert Minute | `#/expert/minute` | voice answer: `panel` → `ApprenticePanel` quick ask |
| Learner | Assistant | `#/learner/assist` | `learner/assistant` → `TutorPanel` (companion) |
| Learner | Knowledge Repository | `#/learner/knowledge[/<map id>]` | — |
| Learner | Expert Minute | `#/learner/minute` | `POST/GET /api/questions` |
| — | ERP work app (separate) | `http://localhost:5173/erp/` (Sabrina `#/`, Lena `#/teach`) | — |

Other routes: `map/<id>` (Work Map page), `library` (coverage overview). Session routes (`work/live`, `work/record`, `learner/assistant`, `panel`) render **bare** (no sidebar): they run in the 420 px companion window. Start them with `openSession(SESSION_ROUTES.x)`; `closeSession("expert/debrief")` closes the companion and switches the main window there (`window.understudy.showInMain`, IPC `main:navigate`). Old `#/inbox`, `#/tutor` still work. `#/erp` inside Understudy only links to the ERP app.

### Ownership

**Renzo built and owns the whole codebase.** There's no file split and no one to coordinate with. Old `SHARED FILE` header comments are history: edit those files freely.

Git: work on `main`. Gitignored: `.env`, session logs (`data/sessions/*.json`), generated maps (`data/workmaps/session-*.json`, `map-*.json` are local data). Local runs modify `data/workmaps/sample-invoice-processing.json`: don't commit it; Reset demo restores it from `data/seed/` (if you edit the sample on purpose, copy it to `data/seed/` too).

## How the session modules behave

- **Work mode setup:** session name field (default "Live/Recorded session · date") + "Or continue an earlier one" (un-debriefed sessions of the same kind). Continuing writes a new session file with the same `name` and `part = n + 1`; each part has its own recording so clips stay aligned. Title = `name` (+ " · part n"). Record mode has the opt-in "Also listen to call audio" (Windows loopback).
- **Live triggers** (`src/agents/pauseRule.ts`): main trigger = task done (ERP save / switching invoice / vision `task_done`); mid-task only important fields (cost_center, approval, status) after a 2.5 s pause; ≥ 8 s between questions; resend once if unanswered after 5 s or interrupted.
- **Debrief & teach:** day sections (Today / Yesterday / date) with **Select day**; one row per name with **Rename** (`renameSessions`) and Delete; bottom: **Prepare debrief (n)** + **Delete selected (n)**. Passes `workflow = name` when one name is selected; the draft map name is renamable before Confirm (`renameWorkMap`). 5:00 cap (wrap-up nudge at 3:45, time-up at 4:40).
- **Assistant:** loads the newest confirmed real map (sample as fallback), sends it as `[WORKMAP]`; blocked save → expert's clip + predict-then-explain; "never showed me" / tutor says "flagged" / unknown typed question → `POST /api/questions` (asker `LEARNER = "Lena"`).
- **Greeting:** full introduction the first time per computer, then short (`greeting()` in `src/agents/prompts.ts`, localStorage).
- **Silence:** both prompts say "..." / silence is normal (no "Are you still there?").
- **Mic** (`useMicHold`): closed from the moment the app sends Claudia a message she must answer until she finishes speaking (max 5 s if she never starts), so noise can't cancel her reply. **Never** closed after the user's own speech (that cut answers off). Mic level bar in live mode; Debug logs "heard you: …".
- **Vision** (`/api/frame`, Haiku): every 3 s (live) / 6 s (record) / 4 s (Assistant), changed frames only, paused while the ERP sends events, ignores the Understudy/Claudia window.
- **Spoken "let's debrief"** was tried and removed: the debrief starts only from its module.

## Shared building blocks (`src/shared/`)

- `relay.ts` (`publish` / `subscribe`): messages between separate apps through the API (`POST|GET(SSE) /api/relay/:channel`). Channels: `erp` (ERP events, via `bus.ts`), `capture` (off the record + reset, `src/capture/control.ts`), `progress` (trainee progress, `src/screens/progress.ts`). CORS allows any `http://localhost:*`; an app on another port sets `VITE_API_BASE=http://localhost:8787`.
- `desktop.ts`: `openSession`, `closeSession`, `SESSION_ROUTES`, `isDesktop`.
- `ConfirmDelete.tsx` (two-click delete) + `deletes.ts`: `deleteSession(id)` (also its recording), `deleteWorkMap(id)` (its sessions become debriefable again), `deleteStep(mapId, stepId)` (orphaned guardrails go too), `deleteQuestion(mapId, qid)`.
- `InlineRename.tsx` (name + "Rename" → field, Enter saves, Esc cancels) + `renames.ts`: `renameSessions(ids, name)` (maps built only from them follow), `renameWorkMap(id, name)` (its sessions follow if they shared one name).
- `types.ts`, `guardrails.ts` (`violatedGuardrails`), `api.ts`, `bus.ts` (`formatMs` too).

## Shell, ERP, capture and screens: how they work

### ERP (`src/erp/`, separate app at `/erp/`)
- Loads invoices from `/api/invoices` (Sabrina: capture invoices; Lena: teach invoices). Edits persist in localStorage per user until Reset demo. Records the trainee's blocked/saved invoices and serves them on the `progress` channel.
- Events (`t = Date.now()`): `invoice_opened`; `field_change` (selects immediately, text fields once on blur); `keystroke` (≤ 1/field/s, no text); `save` (`field: "status", from, to`; saving an open invoice posts it); `guardrail_blocked` (teach only, `field` = guardrail id, `note` = text). No events while off the record. Capture mode never blocks a save.
- Teach mode picks its map like the Assistant and reloads on focus (Gap Loop patches apply without a refresh).

### Capture (`src/capture/`)
- `useScreenRecorder()`: `start(sessionId)` → start time (session zero point); `stop()`; `offRecord`, `setOffRecord(on)`, `offRecordSpans()`, `grabFrame()` (null while off the record).
- Recordings live in **IndexedDB** (`recordings.ts`) keyed by session id, with off-record spans; `deleteRecording(id)`, `clearRecordings()`.
- `<ClipPlayer at sessionId? onClipEnd? onAvailable? />`: 3 s before to 10 s after (max 30 s), maps around off-record cuts, falls back to the newest recording. Chrome pauses video in hidden windows: test walkthroughs in a visible window.
- Off the record: ERP floating button + striped banner; relay channel `capture` (`state`, `request`, `ping`, `reset`).

### Screens (`src/screens/`, shell `src/shell/Shell.tsx`)
- Shell sidebar: Expert/Learner switch (remembered), modules per mode, "Open the work app (ERP) ↗", **Reset demo**.
- Knowledge Repository: task cards (search, mastery, open questions) and a walkthrough player (step clips in order, chapter list, reasons and rules, mastery, "Ask a question"; step slides when a moment has no recording). Rename task (card, task page, Work Map header; `<InlineRename>` + `renameWorkMap`). Delete: on each task card; on the task page (`#/learner/knowledge/<id>`, where a card click lands) "Delete task" in the header and "Delete step" above the current step's caption; same two on the expert Work Map page (`#/map/<id>`).
- Expert Minute: expert side (voice via `setPendingQuickAsk` + `openSession(SESSION_ROUTES.quickAsk)`, or text via `/api/patch`; delete questions); learner side (`POST /api/questions`, "My questions", "Recently answered for the team", **Withdraw**: deletes if Lena was the only asker, else removes her vote).
- Mastery: a step is "practice next" if one of its guardrails blocked a save, "mastered" if a saved invoice fell under one with no block.
- **Reset demo** (`resetDemo.ts`): `reset` on `capture` (ERP clears edits + progress), clears cached progress, pending Quick Ask, recordings, and restores the sample map from `data/seed/`. It does **not** delete maps made from sessions: delete rehearsal maps first.
- Styles: tokens in `src/styles.css` (Inter, `--accent` indigo, `--ok/--warn/--bad` + `-soft`, `--radius`, `--shadow`, `--ring`, `--page-pad`); ERP look in `src/erp/erp.css`; screens in `src/screens/screens.css`; Renzo's session UI in `src/panel/session.css`.

## API (`server/`)

- `GET /api/invoices`, `/api/experts`, `/api/workmaps`, `/api/sessions` (summaries: `mode`, `name`, `part`, `title`, `reviewed_in`, counts); `GET|PUT /api/workmaps/:id`, `/api/sessions/:id`.
- `POST /api/map` `{ sessionIds | sessionId, workflow?, expert, team, mapId?, confirm?, debrief? }` → `{ map, gaps }`. Drafts from one or more sessions (map id = session id, or `map-<ts>` for several); `confirm: true` with the same `mapId` + the debrief transcript folds answers in, marks confirmed, sets sessions' `reviewed_in`. Ignores off-record spans. Steps carry `moment.session`.
- `POST /api/route` `{ question, context?, open? }` → `{ expert_name, reason, neutral_question, duplicate_of }`.
- `POST /api/questions` `{ question, context?, asker?, mapId? }` → `{ question, merged, map_id }`; `GET /api/questions?asker=`.
- `POST /api/patch` `{ workmapId, questionId, answer, expert }` → map with new step + guardrails; stores `answer_clean` from the confirmed repeat-back.
- `POST /api/frame` `{ image, previous? }` → `{ app, changes[], task_done, judgment_call }` (Haiku, structured).
- `POST /api/transcribe?speaker=expert|other&offset=ms` (raw audio) → `{ lines }` (ElevenLabs Scribe v2).
- Deletes: `DELETE /api/sessions/:id`, `/api/workmaps/:id`, `/api/workmaps/:id/steps/:stepId`, `/api/workmaps/:id/questions/:qid`.
- Renames: `POST /api/sessions/rename { ids, name }`, `PATCH /api/workmaps/:id { workflow }` (1–80 chars; kept in sync both ways).
- Relay: `POST|GET(SSE) /api/relay/:channel`. Health: `GET /api/health` → `{ ok, claudeKey }`.

Claude via **MIT Parley** (Anthropic-compatible). `server/env.ts` loads `.env` with override so a shell-level `ANTHROPIC_BASE_URL` can't win. Models: `claude-opus-5-5` (map, route, patch), `claude-haiku-4-5` (frames); override with `MAP_MODEL` / `FRAME_MODEL`. Structured outputs via `client.messages.parse` + zod (`server/claude.ts`). Storage: JSON files under `data/` (`server/store.ts`, ids validated by `safeId`).

## Desktop (`desktop/`, Renzo)

- `main.cjs`: main window + always-on-top companion (420 px, top-right) for live sessions; `backgroundThrottling: false`; screen capture via `setDisplayMediaRequestHandler` (primary screen) with Windows `loopback` audio when the page asks for audio; mic/screen permissions allowed; links that open a new window (incl. the ERP) go to the default browser; single instance; app icon `understudy.ico`, AppUserModelId "Understudy".
- `preload.cjs` → `window.understudy` (`isDesktop`, `platform`, `openCompanion(route)`, `closeCompanion()`, `focusMain()`, `showInMain(route)`).
- Launchers: `launch-desktop.vbs` (runs `npm run desktop` hidden, or `npx electron .` to focus if already running), `launch-browser.vbs` (`npm run dev` hidden if needed, opens http://localhost:5173). `create-shortcuts.ps1` puts "Understudy" + "Understudy (browser)" on the desktop and in the Start menu (`powershell -ExecutionPolicy Bypass -File desktop\create-shortcuts.ps1`).
- Scripts: `npm run desktop` (Vite + API + Electron; Vite `strictPort: true` because Electron loads :5173), `npm run dev` (web only), `npm run typecheck`.

## ElevenLabs

- Two agents (Creator plan): Interviewer `agent_4001m41j8r97eqks9k6y6nk8x05p`, Tutor `agent_1201m41qmexxet890wg5vmqqzsgb` (IDs committed in `.env.development`; public by nature).
- Both are named **Claudia** (`AGENT_NAME`); expert persona **Sabrina**, learner **Lena**, second expert **Marta** (`data/experts.json`). Prompts/first messages live in `src/agents/prompts.ts` and are sent as **session overrides**: edit the code, not the dashboard.
- Dashboard settings that must stay on (both agents): Security → overrides for System prompt + First message; Advanced → **Take turn after silence = 30 s**. Interviewer: Tools → **Skip turn** on. LLM: whatever Renzo picked (Opus works; a Haiku-class model answers faster).
- Dynamic variables: `agent_name`, `expert_name`, plus `mode` (live | debrief | quick_ask) for the Interviewer.
- App → agent prefixes. Silent context: `[SCREEN]`, `[WORKMAP]`, `[OFF RECORD]`, `[ON RECORD]`. Trigger a reply: `[TASK DONE]`, `[PAUSE]`, `[GAPS]`, `[WRAP UP]`, `[TIME UP]`, `[QUESTION]`, `[ADDRESSED]`, `[OPENED]`, `[BLOCKED]`, `[SAVED]`, `[DECIDING]`.

## Lessons / gotchas

- **Never call `sendUserActivity`** on keystrokes: it holds the agent ~2 s and silently swallowed nudges.
- **Background noise cancels the agent's reply** while it prepares it (1–2 s), not only while it speaks → `useMicHold` from the nudge on. But never close the mic after the user speaks: a short pause ends their turn and the rest of the sentence is lost.
- **"Are you still there?"** is ElevenLabs' silence turn ("..."). Fixed in the prompts + Take turn after silence = 30 s.
- Vision described the Claudia window as "work" → the frame prompt ignores it.
- The map prompt must make Claude approximate guardrail checks with available fields (e.g. amount > 5000 EUR for "equipment"), or the capex rule has no check and Teach can't catch the demo mistake.
- Voice answers are messy transcripts; `/api/patch` uses the agent's confirmed repeat-back.
- Electron blocked same-origin `target="_blank"` links (the ERP button did nothing) → now every http(s) new-window link opens in the browser.
- Windows Start search found only the browser shortcut until the shortcuts were also put in the Start menu.
- Some files use CRLF; normalize before string-matching edits. Editing via `node -e` with regexes/quotes breaks easily: prefer the Edit tool or a script file.
- Starting a terminal-panel tab from Claude can time out; start servers with Bash `run_in_background` (and stop them afterwards so Renzo's launcher can bind the ports).
- **Electron binary missing after `npm install`** (`node_modules/electron/dist/electron.exe` absent): run `node node_modules/electron/install.js` once.
- **Blank page / "Invalid hook call" / two React copies** after installing packages while pages are open: stop the app, delete `node_modules/.vite`, restart, fully reload every window.
- **ClipPlayer** falls back to the newest recording only when no `sessionId` is passed (the sample map); a session whose recording is gone shows "no recording" instead of another session's footage. Steps with `said_at: "quick ask"` have no footage: the walkthrough shows a slide, the Work Map page a note. The walkthrough drives play/pause through `playing` (`autoPlay` is read only once the clip loads).
- **Off the record** (`useScreenRecorder`) works from `start()` to `stop()` even when the screen share was cancelled, and the browser's "Stop sharing" keeps the session (and off the record) going; only `stop()` goes back on. On the `capture` channel `recording` now means "a session is running".
- **Mastery is per map**: the ERP records blocks as `"<map id>:<guardrail id>"` and saves with the map it enforced; only those count for a map (old progress stops counting; Reset demo clears it).

## Rules

- Keys only in `.env`. Never commit `.env` or paste keys in chat.
- Personal fields (IBAN, contact) render with class `pii` (blurred) and are never sent to Claude.
- Gap questions never reveal who asked.
- When you change how something works, update this file in the same commit so the other person's Claude picks it up.
