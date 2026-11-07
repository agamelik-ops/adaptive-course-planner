"use client";

import Link from "next/link";
import { useState } from "react";
import { findCourse, type Course, type Day } from "./courses";

const DAYS: { key: Day; label: string }[] = [
  { key: "Mon", label: "Monday" },
  { key: "Tue", label: "Tuesday" },
  { key: "Wed", label: "Wednesday" },
  { key: "Thu", label: "Thursday" },
  { key: "Fri", label: "Friday" },
];

const FIRST_HOUR = 8; // 8am
const LAST_HOUR = 22; // 10pm (last labeled row)
const HOURS = Array.from(
  { length: LAST_HOUR - FIRST_HOUR + 1 },
  (_, i) => FIRST_HOUR + i,
);
const HOUR_HEIGHT = 56; // px per hour row

const COLORS = [
  "bg-sky-200 border-sky-500 text-sky-950",
  "bg-amber-200 border-amber-500 text-amber-950",
  "bg-emerald-200 border-emerald-500 text-emerald-950",
  "bg-rose-200 border-rose-500 text-rose-950",
  "bg-violet-200 border-violet-500 text-violet-950",
  "bg-orange-200 border-orange-500 text-orange-950",
];

function hourLabel(h: number) {
  if (h === 12) return "Noon";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function toHours(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h + m / 60;
}

function formatTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")}${suffix}`;
}

export default function Planner() {
  const [crn, setCrn] = useState("");
  const [selected, setSelected] = useState<Course[]>([]);
  const [error, setError] = useState("");

  function addCourse(e: React.FormEvent) {
    e.preventDefault();
    const value = crn.trim();
    if (!value) return;
    const course = findCourse(value);
    if (!course) {
      setError(`No course found with CRN ${value}.`);
      return;
    }
    if (selected.some((c) => c.crn === course.crn)) {
      setError(`${course.code} is already in your schedule.`);
      return;
    }
    setSelected([...selected, course]);
    setCrn("");
    setError("");
  }

  function removeCourse(crnToRemove: string) {
    setSelected(selected.filter((c) => c.crn !== crnToRemove));
  }

  const emailBody = selected
    .map((c) => {
      const times = c.meetings
        .map(
          (m) =>
            `${m.days.join("/")} ${formatTime(m.start)}–${formatTime(m.end)}`,
        )
        .join("; ");
      return `${c.code} (CRN ${c.crn}) – ${c.title}\n  ${times}, ${c.location}`;
    })
    .join("\n\n");
  const mailto = `mailto:?subject=${encodeURIComponent(
    "My course schedule",
  )}&body=${encodeURIComponent(emailBody)}`;

  return (
    <div className="flex min-h-screen flex-col bg-[#e8e4dd] text-[#333]">
      <header className="bg-[#213a6b] py-5 text-center">
        <Link
          href="/"
          className="font-serif text-2xl tracking-wide text-white"
        >
          Franklin &amp; Marshall
          <span className="ml-2 align-middle text-xs tracking-[0.3em]">
            COLLEGE
          </span>
        </Link>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <h1 className="mb-4 text-4xl font-bold sm:text-5xl">
          Prospective Course Planner
        </h1>

        <div className="flex flex-col gap-8 md:flex-row">
          {/* Sidebar */}
          <aside className="w-full shrink-0 md:w-72">
            <form onSubmit={addCourse}>
              <label htmlFor="crn" className="mb-1 block font-bold">
                Course Reference Number:
              </label>
              <div className="flex">
                <input
                  id="crn"
                  value={crn}
                  onChange={(e) => setCrn(e.target.value)}
                  placeholder="ex: 10060"
                  inputMode="numeric"
                  className="w-full rounded-l border border-gray-300 bg-white px-4 py-2 outline-none focus:border-[#213a6b]"
                />
                <button
                  type="submit"
                  aria-label="Add course"
                  className="rounded-r border border-l-0 border-gray-400 bg-white px-4 text-2xl font-bold hover:bg-gray-100"
                >
                  +
                </button>
              </div>
              {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
              <p className="mt-2 text-xs text-gray-500">
                Sample CRNs: 10060–10066
              </p>
            </form>

            <hr className="my-6 border-gray-300" />

            <h2 className="mb-4 text-3xl font-bold">Selected Courses</h2>

            <ul className="mb-6 space-y-2">
              {selected.map((c, i) => (
                <li
                  key={c.crn}
                  className={`flex items-start justify-between rounded border-l-4 px-3 py-2 ${COLORS[i % COLORS.length]}`}
                >
                  <div>
                    <div className="font-bold">{c.code}</div>
                    <div className="text-sm">{c.title}</div>
                    <div className="text-xs opacity-75">CRN {c.crn}</div>
                  </div>
                  <button
                    onClick={() => removeCourse(c.crn)}
                    aria-label={`Remove ${c.code}`}
                    className="ml-2 text-lg leading-none opacity-60 hover:opacity-100"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            <a
              href={selected.length ? mailto : undefined}
              aria-disabled={!selected.length}
              className={`inline-flex items-center gap-2 rounded bg-[#6ab866] px-4 py-2 text-white ${
                selected.length
                  ? "hover:bg-[#5aa656]"
                  : "cursor-not-allowed opacity-60"
              }`}
            >
              Save it to email
              <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-white text-[10px] leading-none">
                ✓
              </span>
            </a>
          </aside>

          {/* Calendar */}
          <section className="flex-1 overflow-x-auto">
            <div className="min-w-[640px]">
              {/* Day headers */}
              <div className="grid grid-cols-[60px_repeat(5,1fr)] pb-2">
                <div />
                {DAYS.map((d) => (
                  <div key={d.key} className="text-center font-semibold">
                    {d.label}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-[60px_repeat(5,1fr)] border-b border-gray-500">
                {/* Time labels */}
                <div>
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      style={{ height: HOUR_HEIGHT }}
                      className="border-t border-gray-500 pr-2 pt-1 text-right text-sm text-gray-500"
                    >
                      {hourLabel(h)}
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {DAYS.map((d) => (
                  <div key={d.key} className="relative border-l border-gray-400">
                    {HOURS.map((h) => (
                      <div
                        key={h}
                        style={{ height: HOUR_HEIGHT }}
                        className="border-t border-gray-500"
                      >
                        <div
                          style={{ height: HOUR_HEIGHT / 2 }}
                          className="border-b border-gray-300"
                        />
                      </div>
                    ))}

                    {selected.flatMap((c, i) =>
                      c.meetings
                        .filter((m) => m.days.includes(d.key))
                        .map((m, j) => {
                          const top =
                            (toHours(m.start) - FIRST_HOUR) * HOUR_HEIGHT;
                          const height =
                            (toHours(m.end) - toHours(m.start)) * HOUR_HEIGHT;
                          return (
                            <div
                              key={`${c.crn}-${j}`}
                              style={{ top, height }}
                              className={`absolute inset-x-1 overflow-hidden rounded border-l-4 px-2 py-1 text-xs shadow-sm ${COLORS[i % COLORS.length]}`}
                            >
                              <div className="font-bold">{c.code}</div>
                              <div>
                                {formatTime(m.start)}–{formatTime(m.end)}
                              </div>
                              <div className="opacity-75">{c.location}</div>
                            </div>
                          );
                        }),
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
