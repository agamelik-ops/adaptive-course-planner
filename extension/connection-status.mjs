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

// Linked means a usable local audit exists, not an authenticated live session.
export function degreeWorksView(audit, job, now = Date.now()) {
  const linked = Array.isArray(audit?.requirements) && audit.requirements.some((item) => typeof item?.name === "string" && item.name.trim()) && Number.isFinite(Date.parse(audit.checkedAt));
  const importing = job?.state === "importing" && now - job.updatedAt < 300000;
  return {
    linked, importing,
    state: importing ? "connecting" : linked ? "connected" : "disconnected",
    label: importing ? "Importing Degree Works…" : linked ? "Degree Works linked" : "Degree Works not linked",
    detail: linked ? `${audit.courses?.length ?? 0} courses · ${audit.requirements.length} requirements · Imported ${new Date(audit.checkedAt).toLocaleString()}` : "Import your Academic worksheet to use it for recommendations.",
    note: importing ? "Review the import preview in your Degree Works tab." : linked ? "Saved audit snapshot · Reimport after your record changes" : "No audit has been imported yet.",
    button: importing ? "Importing…" : linked ? "Update Degree Works" : "Import Degree Works",
  };
}
