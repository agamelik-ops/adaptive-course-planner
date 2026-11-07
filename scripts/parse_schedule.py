"""Convert the F&M "Master Schedule" PDF into JSON for the course planner.

Usage (needs `pip install pdfplumber`):
    python scripts/parse_schedule.py "path/to/Spring 2027 Master Schedule.pdf" app/planner/courses.json

The PDF lists the same section under several departments / gen-ed areas, so
rows are de-duplicated by CRN. Rows that spill across a page break show up as a
row with an empty CRN; those are glued back onto the previous row.
"""

import json
import re
import sys

import pdfplumber

DAY_MAP = {"M": "Mon", "T": "Tue", "W": "Wed", "R": "Thu", "F": "Fri"}
SCHEDULE_COLS = [
    "crn", "course", "sect", "title", "xlist", "perm", "instructor",
    "type", "days", "start", "end", "dist", "closed", "prereq",
]


def clean(cell):
    return re.sub(r"\s+", " ", (cell or "").replace("\n", " ")).strip()


def to_24h(text):
    m = re.match(r"(\d{1,2}):(\d{2})\s*(AM|PM)", text)
    if not m:
        return None
    h, mins, ampm = int(m[1]), m[2], m[3]
    if ampm == "PM" and h != 12:
        h += 12
    if ampm == "AM" and h == 12:
        h = 0
    return f"{h:02d}:{mins}"


def split_code(code):
    m = re.match(r"([A-Z]+)(\d+)", code)
    return f"{m[1]} {m[2]}" if m else code


def collect_rows(pdf):
    schedule, descriptions = [], []
    for page in pdf.pages:
        for table in page.extract_tables():
            if not table:
                continue
            header = [clean(c).upper() for c in table[0]]
            if header and header[0] == "CRN":
                target, width = schedule, len(SCHEDULE_COLS)
            elif "DESCRIPTION" in header:
                target, width = descriptions, 4
            else:
                continue
            for raw in table[1:]:
                row = [clean(c) for c in raw][:width]
                row += [""] * (width - len(row))
                key = row[0] if target is schedule else row[1]
                if not key and target:
                    # continuation of the previous row across a page break
                    prev = target[-1]
                    for i, val in enumerate(row):
                        if val:
                            prev[i] = f"{prev[i]} {val}".strip()
                elif any(row):
                    target.append(row)
    return schedule, descriptions


def main(pdf_path, out_path):
    with pdfplumber.open(pdf_path) as pdf:
        schedule, descriptions = collect_rows(pdf)

    desc_by_code = {}
    for _, code, _, desc in descriptions:
        if code and desc and code not in desc_by_code:
            desc_by_code[code] = desc

    courses = {}
    for row in schedule:
        r = dict(zip(SCHEDULE_COLS, row))
        if not r["crn"].isdigit():
            continue
        c = courses.setdefault(r["crn"], {
            "crn": r["crn"],
            "code": split_code(r["course"]),
            "section": r["sect"],
            "title": r["title"],
            "instructors": [],
            "dist": [d.strip() for d in r["dist"].split(",") if d.strip()],
            "closedTo": [d.strip() for d in r["closed"].split(",") if d.strip()],
            "prereq": r["prereq"],
            "permission": bool(r["perm"]),
            "crossListed": bool(r["xlist"]),
            "description": desc_by_code.get(r["course"], ""),
            "meetings": [],
        })
        if r["instructor"] and r["instructor"] not in c["instructors"]:
            c["instructors"].append(r["instructor"])

        start, end = to_24h(r["start"]), to_24h(r["end"])
        days = [DAY_MAP[ch] for ch in r["days"].replace(" ", "") if ch in DAY_MAP]
        # 12:00 AM - 12:01 AM with no days is the registrar's "TBA" placeholder
        if not days or not start or not end or start == "00:00":
            continue
        meeting = {"type": r["type"] or "CLAS", "days": days, "start": start, "end": end}
        if meeting not in c["meetings"]:
            c["meetings"].append(meeting)

    data = sorted(courses.values(), key=lambda c: (c["code"], c["section"], c["crn"]))
    with open(out_path, "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    print(f"Wrote {len(data)} sections to {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
