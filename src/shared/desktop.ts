// SHARED FILE: works in the Electron desktop app and in a plain browser.
// In the desktop app, live sessions run in a small always-on-top companion window so the
// expert or learner can keep working in other apps. In a browser, they open in the same tab.

interface UnderstudyBridge {
  isDesktop: true;
  platform: string;
  openCompanion(route: string): Promise<void>;
  closeCompanion(): Promise<void>;
  focusMain(): Promise<void>;
  showInMain?(route: string): Promise<void>;
}

declare global {
  interface Window {
    understudy?: UnderstudyBridge;
  }
}

export const isDesktop = () => Boolean(window.understudy?.isDesktop);

/** Session routes that run in the companion window. */
export const SESSION_ROUTES = {
  workLive: "work/live",
  workRecord: "work/record",
  assistant: "learner/assistant",
  quickAsk: "panel",
} as const;

/** Start a live session: companion window on desktop, same tab in a browser. */
export function openSession(route: string): void {
  if (window.understudy) window.understudy.openCompanion(route);
  else location.hash = `#/${route}`;
}

/** Close the companion (desktop) or go back to the main app (browser). */
export function closeSession(fallbackRoute = ""): void {
  const bridge = window.understudy;
  if (bridge) {
    if (fallbackRoute && bridge.showInMain) bridge.showInMain(fallbackRoute);
    else bridge.focusMain();
    bridge.closeCompanion();
  } else location.hash = `#/${fallbackRoute}`;
}

/** True when this page is running inside the companion window. */
export const inCompanion = () => isDesktop() && window.outerWidth < 600;
