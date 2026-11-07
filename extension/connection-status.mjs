export function connectionView(auto, job, now = Date.now()) {
  const lastSync = auto?.lastSuccessfulAt || (auto?.state === "waiting" && job?.state === "complete" ? job.updatedAt : null);
  const overdue = auto?.state === "waiting" && (!auto.nextCheckAt || now > auto.nextCheckAt + 60000);
  const stalled = auto?.state === "syncing" && now - (job?.state === "running" ? job.updatedAt : auto.updatedAt) > 120000;
  const active = !!auto?.enabled && !overdue && !stalled;
  const connected = active && (auto.state === "waiting" || (auto.state === "syncing" && !!lastSync));
  return {
    active, connected,
    state: connected ? "connected" : active ? "connecting" : "disconnected",
    label: connected ? "Connected to F&M" : active ? "Connecting to F&M…" : "Not connected",
    message: overdue || stalled ? "Updates paused. Reconnect to resume automatic availability checks."
      : auto?.state === "syncing" && job?.state === "running" ? job.message
      : auto?.message || "Connect to import Spring 2027 seat availability automatically.",
    lastSync,
    total: job?.state === "complete" ? job.scanned : null,
  };
}
