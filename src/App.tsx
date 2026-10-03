// SHARED FILE: entry component. The app shell (sidebar, modes, modules, routes) lives in
// src/shell/Shell.tsx (Pablo). Add a route there when you add a screen, and tell the other person.
import { Shell } from "./shell/Shell";

export function App() {
  return <Shell />;
}
