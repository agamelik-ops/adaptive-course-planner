export const AVAILABILITY_KEY = "fm-availability:spring-2027:v1";
export type Availability = {
  crn: string;
  status: string;
  checkedAt: string;
  changedAt: string | null;
  seats: number | null;
  capacity: number | null;
  waitlist: number | null;
  waitlistCapacity: number | null;
  reserved: boolean;
};

export function parseAvailability(raw: string | null): Record<string, Availability> {
  const result: Record<string, Availability> = {};
  try {
    const data = JSON.parse(raw ?? "null");
    if (data?.version !== 1 || data.term !== "202620" || !Array.isArray(data.records) || data.records.length > 2000) return result;
    for (const row of data.records) {
      if (!row || typeof row.crn !== "string" || !/^\d{5}$/.test(row.crn) || typeof row.status !== "string" || !row.status.trim() || row.status.length > 1000 || typeof row.checkedAt !== "string") continue;
      const stamp = Date.parse(row.checkedAt);
      if (!Number.isFinite(stamp) || stamp > Date.now() + 60000) continue;
      const seatMatch = row.status.match(/(\d+)\s+of\s+(\d+)\s+seats?\s+remain/i);
      const waitMatch = row.status.match(/(\d+)\s+of\s+(\d+)\s+waitlist\s+seats?\s+remain/i);
      const seats = seatMatch ? Number(seatMatch[1]) : null;
      const capacity = seatMatch ? Number(seatMatch[2]) : null;
      if (waitMatch && Number(waitMatch[1]) > Number(waitMatch[2])) continue;
      if (seats !== null && capacity !== null && seats > capacity) continue;
      result[row.crn] = { crn: row.crn, status: row.status, checkedAt: row.checkedAt, changedAt: typeof row.changedAt === "string" && Number.isFinite(Date.parse(row.changedAt)) && Date.parse(row.changedAt) <= stamp ? row.changedAt : null, seats, capacity,
        waitlist: waitMatch ? Number(waitMatch[1]) : null, waitlistCapacity: waitMatch ? Number(waitMatch[2]) : null, reserved: /reserved|waitlisted only/i.test(row.status) };
    }
  } catch { /* Missing or invalid imported data stays unknown. */ }
  return result;
}

export function availabilityLabel(record?: Availability) {
  if (!record || record.seats === null) return "Availability unknown";
  if (record.reserved) return `${record.seats} seats remaining · Reserved`;
  return record.seats === 0 ? "Full" : `${record.seats} of ${record.capacity} seats remaining`;
}

export function readAvailability() {
  try { return window.localStorage.getItem(AVAILABILITY_KEY); } catch { return null; }
}
export function serverAvailability() { return null; }
export function subscribeAvailability(onChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === AVAILABILITY_KEY || event.key === "fm-availability-auto" || event.key === null) onChange(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener("fm-availability-change", onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("fm-availability-change", onChange);
  };
}

export function readAutoUpdates() {
  try { return window.localStorage.getItem("fm-availability-auto"); } catch { return null; }
}
export function autoUpdateLabel(raw: string | null, now: number) {
  try {
    const state = JSON.parse(raw ?? "null");
    if (!state?.enabled) return "Updates paused · Saved availability only";
    if (state.state === "connecting") return "Connecting to F&M · Complete sign-in or select Spring 2027 in the opened tab";
    if (state.state === "syncing") return now - state.updatedAt > 120000 ? "Updates paused · Reconnect Browse Classes" : "Refreshing availability…";
    if (state.state === "waiting" && typeof state.nextCheckAt === "number" && now <= state.nextCheckAt + 60000) return "Automatic updates on · Plan every 5 minutes · Catalog every 30 minutes";
  } catch { /* Unknown state stays paused. */ }
  return "Updates paused · Reconnect Browse Classes";
}
