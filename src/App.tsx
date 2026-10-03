// SHARED FILE: hash routes. Add a route here when you add a screen, and tell the other person.
import { useEffect, useState } from "react";
import { ErpPage } from "./erp/ErpPage";
import { ApprenticePanel } from "./panel/ApprenticePanel";
import { TutorPanel } from "./panel/TutorPanel";
import { WorkSession } from "./panel/WorkSession";
import { DebriefModule } from "./panel/DebriefModule";
import { SESSION_ROUTES, openSession } from "./shared/desktop";
import { InboxScreen } from "./screens/InboxScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { WorkMapScreen } from "./screens/WorkMapScreen";

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "");
}

const LINKS: [string, string][] = [
  ["erp", "ERP (expert)"],
  ["panel", "Apprentice panel"],
  ["erp/teach", "ERP (new hire)"],
  ["tutor", "Tutor"],
  ["library", "Library"],
  ["inbox", "Expert Minute"],
];

export function App() {
  const route = useHash();
  const [page, arg] = route.split("/");

  // Live session routes (Renzo): no navigation, they run in the small companion window on desktop.
  if (route === "learner/assistant")
    return (
      <main className="session-main">
        <TutorPanel />
      </main>
    );
  if (route === "work/live" || route === "work/record")
    return (
      <main className="session-main">
        <WorkSession key={route} mode={arg === "record" ? "record" : "live"} />
      </main>
    );

  let body;
  if (page === "erp") body = <ErpPage mode={arg === "teach" ? "teach" : "capture"} />;
  else if (page === "panel") body = <ApprenticePanel />;
  else if (page === "tutor") body = <TutorPanel />;
  else if (page === "library") body = <LibraryScreen />;
  else if (page === "inbox") body = <InboxScreen />;
  else if (page === "map" && arg) body = <WorkMapScreen id={arg} />;
  else if (route === "expert/debrief") body = <DebriefModule />;
  // Temporary home until the new shell lands (Pablo): quick access to the desktop modules.
  else
    body = (
      <div className="row">
        <button onClick={() => openSession(SESSION_ROUTES.workLive)}>Expert · Work mode: live</button>
        <button onClick={() => openSession(SESSION_ROUTES.workRecord)}>Expert · Work mode: record &amp; learn</button>
        <a href="#/expert/debrief">Expert · Debrief &amp; teach</a>
        <button onClick={() => openSession(SESSION_ROUTES.assistant)}>Learner · Assistant</button>
      </div>
    );

  return (
    <>
      <nav className="top">
        <a href="#/">
          <b>Understudy</b>
        </a>
        {LINKS.map(([href, label]) => (
          <a key={href} href={`#/${href}`} className={route === href ? "on" : ""}>
            {label}
          </a>
        ))}
      </nav>
      <main>{body}</main>
    </>
  );
}
