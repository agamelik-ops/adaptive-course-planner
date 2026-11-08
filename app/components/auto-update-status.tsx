"use client";

import { useSyncExternalStore } from "react";
import { autoUpdateLabel, readAutoUpdates, serverAvailability, subscribeAvailability } from "../lib/availability";

// A browser-only clock that ticks every 15s. Date.now() is only read inside
// subscribe/interval callbacks, never during render, so Next.js can prerender
// the page without baking in a stale timestamp.
let clockNow = 0;
function subscribeClock(onChange: () => void) {
  clockNow = Date.now();
  onChange();
  const timer = window.setInterval(() => { clockNow = Date.now(); onChange(); }, 15000);
  return () => window.clearInterval(timer);
}
const readClock = () => clockNow;
const serverClock = () => 0;

export default function AutoUpdateStatus() {
  const raw = useSyncExternalStore(subscribeAvailability, readAutoUpdates, serverAvailability);
  const now = useSyncExternalStore(subscribeClock, readClock, serverClock);
  return <span className="auto-update-status" role="status">{autoUpdateLabel(raw, now)}</span>;
}
