// Owner: Pablo. Entry point of the separate ERP app (http://localhost:5173/erp/).
// #/teach signs in as the trainee; anything else as the expert.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { ErpPage, type Mode } from "./ErpPage";

const modeFromHash = (): Mode => (location.hash.replace(/^#\/?/, "") === "teach" ? "teach" : "capture");

function ErpApp() {
  const [mode, setMode] = useState(modeFromHash);
  useEffect(() => {
    const on = () => setMode(modeFromHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return <ErpPage mode={mode} onSwitchUser={(m) => (location.hash = m === "teach" ? "#/teach" : "#/")} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErpApp />
  </StrictMode>,
);
