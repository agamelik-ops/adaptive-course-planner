"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { autoUpdateLabel, readAutoUpdates, serverAvailability, subscribeAvailability } from "../lib/availability";

export default function AutoUpdateStatus() {
  const raw = useSyncExternalStore(subscribeAvailability, readAutoUpdates, serverAvailability);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="auto-update-status" role="status">{autoUpdateLabel(raw, now)}</span>;
}
