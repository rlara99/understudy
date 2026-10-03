// Owner: Pablo. Know-how Library: one card per Work Map with coverage counts and open questions.
import { useEffect, useState } from "react";
import { getJson } from "../shared/api";
import type { WorkMap } from "../shared/types";

export function LibraryScreen() {
  const [maps, setMaps] = useState<WorkMap[]>([]);
  useEffect(() => {
    getJson<WorkMap[]>("/api/workmaps").then(setMaps);
  }, []);

  return (
    <div className="screen">
      <h2>Library</h2>
      <div className="cards">
        {maps.map((m) => {
          const open = m.open_questions.filter((q) => q.status === "open").length;
          return (
            <a key={m.id} className="card" href={`#/map/${m.id}`}>
              <b>{m.workflow}</b>
              <span className="muted">
                {m.expert} · {m.team}
              </span>
              <span>
                {m.steps.length} steps · {m.guardrails.length} guardrails
              </span>
              <span>
                {m.confirmed ? "Confirmed" : "Draft"}
                {open > 0 && ` · ${open} open question${open > 1 ? "s" : ""}`}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
