// Owner: Renzo. Voice tutor for the new hire (Tutor agent). Build in phase 2 (1:30-2:30).
// TODO:
// 1. Load the Work Map (GET /api/workmaps/:id) and send it as "[WORKMAP] {...}" via sendContextualUpdate after connect.
// 2. Forward ERP events as "[SCREEN] ...". On "guardrail_blocked", send a user message "[BLOCKED] <guardrail text>".
// 3. Client tools (also define them in the dashboard with the same names and parameters):
//    replay_moment({ clip_s }) -> seek the expert's recording
//    flag_open_question({ question, context }) -> POST /api/route, then add to the Work Map's open_questions
//    get_guardrails() -> return the guardrail texts
export function TutorPanel() {
  return (
    <div className="panel">
      <h2>Tutor</h2>
      <p className="muted">Not built yet. See the TODO list in src/panel/TutorPanel.tsx.</p>
    </div>
  );
}
