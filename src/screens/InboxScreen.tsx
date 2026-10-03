// Owner: Pablo. Expert Minute inbox: open questions routed to experts, no names of who asked.
import { useEffect, useState } from "react";
import { getJson } from "../shared/api";
import type { Expert, WorkMap } from "../shared/types";

export function InboxScreen() {
  const [maps, setMaps] = useState<WorkMap[]>([]);
  const [experts, setExperts] = useState<Expert[]>([]);
  useEffect(() => {
    getJson<WorkMap[]>("/api/workmaps").then(setMaps);
    getJson<Expert[]>("/api/experts").then(setExperts);
  }, []);

  const questions = maps.flatMap((m) =>
    m.open_questions.filter((q) => q.status === "open").map((q) => ({ ...q, map: m })),
  );
  const name = (n?: string) => experts.find((e) => e.name === n)?.name ?? "Unassigned";

  return (
    <div className="screen">
      <h2>Expert Minute</h2>
      <p className="muted">About 3 minutes a day. Answer by voice.</p>
      <ul className="cards">
        {questions.map((q) => (
          <li key={q.id} className="card">
            <b>{q.q}</b>
            <span className="muted">{q.context}</span>
            <span>
              For {name(q.route_to)} · asked by {q.asked_by_count} {q.asked_by_count === 1 ? "person" : "people"}
            </span>
            {/* TODO: "Start 3-min session" opens the panel in quick_ask mode with this question */}
          </li>
        ))}
      </ul>
    </div>
  );
}
