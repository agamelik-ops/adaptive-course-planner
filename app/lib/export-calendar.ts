type CalendarCourse = {
  crn: string;
  code: string;
  title: string;
  meetings: {
    days: (number | string)[];
    start: number | string;
    end: number | string;
    type?: string;
  }[];
};

const escapeText = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");

function minutes(value: number | string) {
  if (typeof value === "number") return value;
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

const stamp = (date: Date) =>
  date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

// Convert New York class times to UTC, including daylight saving.
function utc(date: string, minute: number) {
  const target = Date.parse(`${date}T00:00:00Z`) + minute * 60000;
  let guess = target;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(
      formatter.formatToParts(guess).map(part => [part.type, part.value])
    );

    const wall = Date.UTC(
      +p.year, +p.month - 1, +p.day,
      +p.hour, +p.minute, +p.second
    );

    guess += target - wall;
  }

  return stamp(new Date(guess));
}

export function buildCalendar(courses: CalendarCourse[]) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FM Student Planner//Spring 2027//EN",
    "CALSCALE:GREGORIAN"
  ];

  const now = stamp(new Date());
  const skipped: string[] = [];
  let count = 0;

  for (const course of courses) {
    if (!course.meetings.length) skipped.push(course.code);

    course.meetings.forEach((meeting, index) => {
      const start = minutes(meeting.start);
      const end = minutes(meeting.end);
      const days = meeting.days.map(day =>
        typeof day === "number"
          ? day
          : ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(day)
      );

      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end > 1440 ||
        end <= start ||
        !days.length ||
        days.some(day => !Number.isInteger(day) || day < 0 || day > 4)
      ) {
        throw new Error(`Check meeting times and days for ${course.code}.`);
      }

      for (
        let date = new Date("2027-01-19T00:00:00Z");
        date <= new Date("2027-04-29T00:00:00Z");
        date.setUTCDate(date.getUTCDate() + 1)
      ) {
        const day = date.toISOString().slice(0, 10);
        const weekday = (date.getUTCDay() + 6) % 7;

        if (!days.includes(weekday)) continue;

        // Spring recess.
        if (day > "2027-03-12" && day < "2027-03-22") continue;

        const lower =
          day === "2027-01-19" || day === "2027-03-22" ? 480 : 0;

        const upper =
          day === "2027-03-12" ? 990 :
          day === "2027-04-29" ? 1085 : 1440;

        if (start < lower || start >= upper) continue;

        lines.push(
          "BEGIN:VEVENT",
          `UID:fm-2027-${encodeURIComponent(course.crn)}-${index}-${day}@student-planner.invalid`,
          `DTSTAMP:${now}`,
          `DTSTART:${utc(day, start)}`,
          `DTEND:${utc(day, Math.min(end, upper))}`,
          `SUMMARY:${escapeText(
            `${course.code}${meeting.type === "LAB" ? " · Lab" : ""}`
          )}`,
          `DESCRIPTION:${escapeText(
            `${course.title}\nCRN ${course.crn}\nPlanning only; verify meeting dates with your instructor.`
          )}`,
          "END:VEVENT"
        );

        count++;
      }
    });
  }

  if (!count) {
    throw new Error(
      "No scheduled meetings to export. TBA courses cannot be added to a calendar."
    );
  }

  lines.push("END:VCALENDAR");

  // Calendar files require long lines to be folded.
  function fold(line: string) {
    let result = "";
    let size = 0;

    for (const char of line) {
      const bytes = new TextEncoder().encode(char).length;

      if (size + bytes > 75) {
        result += "\r\n ";
        size = 1;
      }

      result += char;
      size += bytes;
    }

    return result;
  }

  return {
    text: lines.map(fold).join("\r\n") + "\r\n",
    count,
    skipped
  };
}

export function downloadCalendar(courses: CalendarCourse[]) {
  const result = buildCalendar(courses);
  const blob = new Blob([result.text], {
    type: "text/calendar;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "fm-spring-2027.ics";
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 30000);

  return result;
}