// Owner: Pablo. Work Map timeline: moment, decision, reason in the expert's words, guardrails.
import { useEffect, useState } from "react";
import { getJson } from "../shared/api";
import type { WorkMap } from "../shared/types";

export function WorkMapScreen({ id }: { id: string }) {
  const [map, setMap] = useState<WorkMap | null>(null);
  useEffect(() => {
    getJson<WorkMap>(`/api/workmaps/${id}`).then(setMap);
  }, [id]);
  if (!map) return <p className="muted">Loading…</p>;

  const guardrail = (gid: string) => map.guardrails.find((g) => g.id === gid);

  return (
    <div className="screen">
      <h2>{map.workflow}</h2>
      <p className="muted">
        {map.expert} · {map.confirmed ? "Confirmed" : "Draft"}
      </p>
      <ol className="steps">
        {map.steps.map((s) => (
          <li key={s.id}>
            {/* TODO: clicking the moment plays the recording at s.moment.clip_s */}
            <span className="t">{s.moment.t}</span> <b>{s.title}</b>
            <div>{s.decision}</div>
            <q>{s.reason}</q> <span className="muted">said at {s.said_at}</span>
            <ul>
              {s.guardrails.map((gid) => (
                <li key={gid} className="guardrail">
                  {guardrail(gid)?.text ?? gid}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
