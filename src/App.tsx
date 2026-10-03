// SHARED FILE: hash routes. Add a route here when you add a screen, and tell the other person.
import { useEffect, useState } from "react";
import { ErpPage } from "./erp/ErpPage";
import { ApprenticePanel } from "./panel/ApprenticePanel";
import { TutorPanel } from "./panel/TutorPanel";
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

  let body;
  if (page === "erp") body = <ErpPage mode={arg === "teach" ? "teach" : "capture"} />;
  else if (page === "panel") body = <ApprenticePanel />;
  else if (page === "tutor") body = <TutorPanel />;
  else if (page === "library") body = <LibraryScreen />;
  else if (page === "inbox") body = <InboxScreen />;
  else if (page === "map" && arg) body = <WorkMapScreen id={arg} />;
  else body = <p className="muted">Open the ERP and the Apprentice panel in two separate tabs.</p>;

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
