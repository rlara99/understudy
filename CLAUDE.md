# Understudy

Hackathon build (Hack-Nation Challenge 01, "The AI Apprentice", ElevenLabs). Four hours, two people.
An AI apprentice that captures an expert's judgment while they work (Capture), turns it into a Work Map (Map), coaches new hires (Teach), and sends questions it can't answer back to the right expert (Gap Loop, our differentiator).

Plan and task split: `docs/build-split.html`. Concept: `docs/concept-deck.html`.

## Run

```
npm install
cp .env.example .env   # fill in values (shared privately)
npm run dev            # web on http://localhost:5173, API on :8787
npm run typecheck
```

Open two tabs: `/#/erp` (fake ERP) and `/#/panel` (voice panel). ERP events reach the panel over BroadcastChannel `"erp"`.

## Who owns what

Only edit files you own. Change shared files together, then push right away.

| Path | Owner |
|---|---|
| `server/**` (API, Claude calls, JSON store) | Renzo |
| `src/agents/**` (prompts, pause rule) | Renzo |
| `src/panel/**` (interviewer + tutor panels) | Renzo |
| `src/erp/**` (fake ERP, Save hook) | Pablo |
| `src/capture/**` (screen share, recording, frames) | Pablo |
| `src/screens/**` (Work Map, Library, Expert Minute) | Pablo |
| `data/invoices.json`, `data/experts.json` | Pablo |
| `src/shared/**`, `src/App.tsx`, `src/styles.css`, `CLAUDE.md` | Shared |

Git: `git pull` before starting, commit small, push at each checkpoint (0:20, 1:30, 2:30, 3:15). Work on `main`.

## Shared formats (`src/shared/types.ts`)

- `ErpEvent`: `{ t, type, invoice, field?, from?, to?, note? }`. ERP sends `t = Date.now()`; the panel rewrites it to ms since recording start.
- `WorkMap`: steps (moment, decision, reason in the expert's words, said_at), guardrails (text, quote, machine `check`), open_questions, confirmed.
- `GuardrailCheck`: if every `when` condition holds and `require` does not, the save is blocked. Evaluate with `violatedGuardrails()` in `src/shared/guardrails.ts`.
- `Expert`: `{ id, name, title, team, topics }`, used to route gap questions.
- `data/workmaps/sample-invoice-processing.json` is a hand-made example so screens can be built before `/api/map` works.

## API (`server/`)

- `GET /api/invoices`, `GET /api/experts`, `GET /api/workmaps`, `GET|PUT /api/workmaps/:id`, `GET|PUT /api/sessions/:id`
- `POST /api/frame` `{ image, previous? }` → `{ changes[] }` (optional; cut first if behind)
- `POST /api/map` `{ sessionId, workflow, expert, team }` → `{ map, gaps }`
- `POST /api/route` `{ question, context? }` → `{ expert_id, reason, neutral_question }`
- `POST /api/patch` `{ workmapId, questionId, answer, expert }` → updated map

Claude calls live in `server/claude.ts`. Models: `claude-opus-5-5` for map/route/patch, `claude-haiku-4-5` for frames (speed). Override with `MAP_MODEL` / `FRAME_MODEL`.

## ElevenLabs

- Two agents in the dashboard: Interviewer and Tutor. Prompts and first messages are in `src/agents/prompts.ts`; paste them in.
- Agents must be public (no auth) so the browser can start a session with just the agent ID.
- Interviewer dynamic variables: `mode` (live | debrief | quick_ask), `expert_name`. Tutor: `expert_name`.
- Enable the `skip_turn` system tool on the Interviewer.
- Tutor client tools (define in the dashboard with the same names): `replay_moment { clip_s }`, `flag_open_question { question, context }`, `get_guardrails {}`.
- Message prefixes the agents understand: `[SCREEN]` (context update, never spoken to), `[PAUSE]`, `[GAPS]`, `[QUESTION]`, `[WORKMAP]`, `[BLOCKED]`.
- Minutes are metered on the Creator plan: test with short calls, rehearse with voice.

## Rules

- Keys only in `.env`. Never commit `.env` or paste keys in chat.
- Personal fields (IBAN, contact) render with class `pii` (blurred) and must never be sent to Claude.
- The Interviewer never says who asked a question in Quick Ask.
- If behind, cut in this order: vision frames, real question merging, live mastery scoring, voice Quick Ask.
