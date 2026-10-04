# Understudy

**An AI apprentice that learns from the expert, coaches the new hire, and goes back to ask about whatever it doesn't know yet.**

Built at Hack-Nation's 7th Global AI Hackathon for Challenge 01, *The AI Apprentice* (powered by ElevenLabs), by Renzo Lara (MIT Sloan).

Experienced people carry decades of judgment that was never written down: why an invoice gets re-coded, which supplier double-bills in December, when to stop and ask. Screen recordings show *what* happened, not *why*. Understudy sits next to the expert while they work, asks why at the right moments, turns the session into a Work Map, and uses it to coach the next hire on cases the expert never showed.

## What makes it different: the Gap Loop

Most apprentices stop once the Work Map is recorded. Understudy keeps learning from where new hires actually get stuck:

```
Expert works  ->  Work Map  ->  New hire learns  ->  hits a case nobody showed
      ^                                                        |
      +---- 60-second Expert Minute, by voice  <---- flagged, routed to the right expert
```

1. The new hire opens a case the Work Map doesn't cover (in the demo, an invoice in USD) or says "Sabrina never showed me this".
2. The tutor flags it. The question is rewritten in neutral terms (no names, nothing about who asked), merged with similar questions ("asked by 3 people"), and routed to the best-placed expert by role and topic. That's not necessarily the boss.
3. The expert gets it in their **Expert Minute** inbox and answers it by voice in under a minute.
4. The answer becomes a new Work Map step and guardrail, the badge clears, and the tutor can now coach that case.

## The three modules

| Module | What happens |
|---|---|
| **1. Capture** | The expert shares their screen and works in the ERP. Claudia (an ElevenLabs voice agent) stays quiet while they type. When a task is finished, she asks one short question about the judgment call behind it, or just acknowledges routine work. |
| **2. Map** | When the task ends, Claude turns the events and transcript into a draft Work Map and lists the gaps. A spoken debrief, capped at 3.5 minutes, asks 3–5 follow-up questions and ends with a teach-back the expert confirms or corrects. Every step links to its moment on screen and the expert's own words. |
| **3. Teach** | A new hire works cases the expert never showed. When they try to save something that breaks a guardrail (e.g. a €7,200 equipment invoice booked as opex), the save is blocked, the expert's clip plays, and the tutor asks "Sabrina would stop here. Why do you think?" before explaining with her reasoning. |

## The Apprentice Test

| Question | How Understudy answers it |
|---|---|
| **When to ask** | The ERP reports exact events. The main trigger is a finished task (an invoice saved or left). Mid-task, Claudia only asks after a real pause following an important change, never while the expert is typing. The mic is muted while she talks, so background noise can't cut her off. |
| **What to ask** | She gets every change made on the invoice and asks only about judgment calls the screen can't explain (recodes, holds, extra approvals, limits), and at least one guardrail per session. Routine work gets a short acknowledgement instead. |
| **When it has understood** | The debrief works through the gaps Claude found in the draft map, then plays the whole process back. The map is only marked *Confirmed* after the expert says "yes, that's how it works", with corrections folded in. |
| **Whether the new hire learned** | The new hire processes unseen invoices. Guardrails are compiled into machine-checkable rules, so a wrong decision is caught *before* it is saved. A mastery panel shows what they've got and what to practice next. |
| **Trust** | Personal fields (IBAN, contact names) are blurred on screen and never sent to the model. **Off the record** (button or spoken) pauses the screen recording, ERP events, mic and transcript together, so that part is never captured, rather than deleted afterwards. The Work Map is told to ignore anything in those spans. Gap questions never reveal who asked. |

## How it's built

```
Fake ERP tab ──BroadcastChannel──> Apprentice panel ──> ElevenLabs Interviewer agent (Claudia)
     │                                   │   context updates, task-done / pause nudges
     │ guardrail checks on Save          │
     │                                   └─> /api/map ──> Claude (via MIT Parley) ──> Work Map JSON
     └──────────────────────────────> Tutor panel ──> ElevenLabs Tutor agent
                                         │   blocked save -> expert's clip + predict-then-explain
                                         └─> /api/route (expert + dedupe) -> Expert Minute -> /api/patch
```

- **Frontend:** Vite, React and TypeScript. Hash routes for the ERP (expert and new-hire modes), the Apprentice panel, the Tutor, the Work Map, the Library and the Expert Minute inbox.
- **Voice:** two ElevenLabs agents (`@elevenlabs/react`, WebRTC). Their prompts live in `src/agents/prompts.ts` and are sent as session overrides, so the code is the single source of truth.
- **Reasoning:** Claude through the Anthropic SDK with structured outputs (`server/routes/ai.ts`): building the Work Map, routing and deduplicating gap questions, and turning spoken answers into steps and guardrails. Calls go through MIT's Parley gateway.
- **Screen recording:** `MediaRecorder` with recordings in IndexedDB. Clips play 3 s before to 10 s after each moment (30 s max).
- **Storage:** JSON files under `data/`. Small enough for a demo, easy to inspect.

## Run it

Requirements: Node 20+, a Claude API key (or MIT Parley key), and two ElevenLabs agents with **System prompt** and **First message** overrides enabled.

```bash
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL for Parley)
npm run dev              # web on http://localhost:5173, API on :8787
```

Agent IDs are in `.env.development`. Then open:

| As | Tabs |
|---|---|
| The expert (Sabrina) | `/#/erp` and `/#/panel`: Start capture, process INV-4471 to 4473, Finish task, debrief, Confirm |
| The new hire (Lena) | `/#/erp/teach` and `/#/tutor`: try INV-5102 as opex, then INV-5103 (USD) |
| Another expert (Marta) | `/#/inbox`: answer the flagged question by voice |
| Anyone | `/#/library`: coverage, mastery and open questions. **Reset demo** restores the seed data. |

## Repo map

| Path | What |
|---|---|
| `src/erp/` | Fake ERP: invoices, Save hook with guardrail checks, off-the-record button |
| `src/panel/` | Apprentice panel (capture, debrief, Quick Ask) and Tutor panel |
| `src/agents/` | Agent prompts and the question-timing rule |
| `src/capture/` | Screen recorder, recordings store, clip player |
| `src/screens/` | Work Map, Library, Expert Minute inbox, mastery |
| `src/shared/` | Shared types, event bus, guardrail checker |
| `server/` | API: data routes and the Claude routes (`/api/map`, `/api/route`, `/api/patch`, `/api/frame`) |
| `data/` | Seed invoices, expert profiles, sample Work Map |
| `docs/` | Concept deck and build plan |
