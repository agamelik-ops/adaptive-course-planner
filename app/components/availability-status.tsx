import type { Availability } from "../lib/availability";

function SeatBar({ label, remaining, capacity }: { label: string; remaining: number | null; capacity: number | null }) {
  const known = remaining !== null && capacity !== null;
  const percent = known && capacity > 0 ? Math.min(100, Math.max(0, remaining / capacity * 100)) : 0;
  return <span className="seat-metric"><span className="seat-label">{label}</span><span className={`seat-bar ${remaining === 0 && known ? "empty" : ""}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={capacity && capacity > 0 ? capacity : 1} aria-valuenow={remaining ?? 0} aria-valuetext={known ? `${remaining} of ${capacity} remaining` : "Unknown"}>
    <span className="seat-fill" style={{ width: `${percent}%` }} /><span className="seat-count">{known ? `${remaining} / ${capacity}` : "Unknown"}</span>
  </span></span>;
}

export default function AvailabilityStatus({ record, detailed = false }: { record?: Availability; detailed?: boolean }) {
  return <span className="availability-status">
    <SeatBar label="Seats available" remaining={record?.seats ?? null} capacity={record?.capacity ?? null} />
    <SeatBar label="Waitlist seats left" remaining={record?.waitlist ?? null} capacity={record?.waitlistCapacity ?? null} />
    {record?.reserved && <span className="seat-warning">Open seats reserved for waitlisted students</span>}
    {record?.seats === 0 && <span className="seat-warning">Class full</span>}
    {record && <small>Last checked {new Date(record.checkedAt).toLocaleString()}</small>}
    {record && <small>Last changed {record.changedAt ? new Date(record.changedAt).toLocaleString() : "No changes observed yet"}</small>}
    {detailed && record && <><span className="availability-raw">{record.status}</span><small>Availability can change before registration.</small></>}
  </span>;
}
