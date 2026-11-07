import { meeting, time, type Course } from "./courses";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

// A standalone document: opens offline and can be printed or saved as a PDF.
export function plannerDocument(courses: Course[]) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const rows = courses.map((course) => `<tr><td>${escapeHtml(course.code)}${course.section ? ` (${escapeHtml(course.section)})` : ""}</td><td>${escapeHtml(course.crn)}</td><td>${escapeHtml(course.title)}</td><td>${escapeHtml(meeting(course))}</td></tr>`).join("");
  const columns = days.map((day, index) => `<section><h3>${day}</h3>${courses.flatMap((course) => course.meetings.filter((item) => item.days.includes(index)).map((item) => ({ course, item }))).sort((a, b) => a.item.start - b.item.start).map(({ course, item }) => `<article><strong>${escapeHtml(course.code)}${item.type === "LAB" ? " · Lab" : ""}</strong><p>${time(item.start)}–${time(item.end)}</p><p>${escapeHtml(course.title)}</p><small>CRN ${escapeHtml(course.crn)}</small></article>`).join("") || "<p>No scheduled classes</p>"}</section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spring 2027 Prospective Course Plan</title><style>body{font:14px Arial,sans-serif;color:#203449;max-width:1200px;margin:40px auto;padding:0 24px}h1{font-family:Georgia,serif;font-weight:400}header{border-bottom:3px solid #173c64;margin-bottom:24px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #ddd;vertical-align:top}.week{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:28px 0}h3{font-size:13px}article{background:#edf2f6;border-left:3px solid #173c64;padding:10px;margin:10px 0;break-inside:avoid}article p{font-size:12px;margin:7px 0}footer{font-size:12px;color:#627383;margin-top:28px}@media(max-width:700px){.week{grid-template-columns:1fr}table{font-size:11px}}@media print{body{margin:0;padding:12px}.week{grid-template-columns:repeat(5,1fr)}@page{size:landscape;margin:12mm}}</style></head><body><header><p>F&M · Adaptive Course Planner</p><h1>Spring 2027 Prospective Course Plan</h1><p>${courses.length} selected sections</p></header><h2>Weekly overview</h2><div class="week">${columns}</div><h2>Selected courses</h2><table><thead><tr><th>Course / section</th><th>CRN</th><th>Title</th><th>Meetings</th></tr></thead><tbody>${rows}</tbody></table><footer>Planning does not register you or confirm seat availability. TBA courses appear in the course list. All times are Eastern. Open this file offline, or use your browser’s Print menu to save as PDF.</footer></body></html>`;
}

export function downloadPlan(courses: Course[]) {
  const blob = new Blob([plannerDocument(courses)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fm-spring-2027-course-plan.html";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Allow the browser to begin reading the file before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens the browser's print dialog; choose Save as PDF as the destination. */
export function printPlan(courses: Course[]) {
  const frame = document.createElement("iframe");
  frame.title = "Printable course plan";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0";
  frame.onload = () => {
    const target = frame.contentWindow;
    if (!target) { frame.remove(); return; }
    target.addEventListener("afterprint", () => frame.remove(), { once: true });
    target.focus();
    target.print();
  };
  frame.srcdoc = plannerDocument(courses);
  document.body.appendChild(frame);
}

export async function downloadPlanPng(courses: Course[]) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image export is unavailable in this browser.");
  const width = 1600;
  const padding = 50;
  const gap = 18;
  const columnWidth = (width - padding * 2 - gap * 4) / 5;
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  // Measure wrapped text before sizing, so long titles and TBA rows never clip.
  function lines(text: string, maxWidth: number, font: string) {
    ctx!.font = font;
    const result: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      if (line && ctx!.measureText(`${line} ${word}`).width > maxWidth) { result.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) result.push(line);
    return result;
  }
  const columns = days.map((_, day) => courses.flatMap((course) => course.meetings.filter((item) => item.days.includes(day)).map((item) => ({ course, item, title: lines(course.title, columnWidth - 28, "17px Arial") }))).sort((a, b) => a.item.start - b.item.start));
  const weekHeight = Math.max(90, ...columns.map((items) => items.reduce((sum, item) => sum + 112 + item.title.length * 23, 0)));
  const rows = courses.map((course) => ({ course, details: lines(`${course.title} · ${meeting(course)}`, width - padding * 2 - 30, "19px Arial") }));
  const listY = 245 + weekHeight;
  const height = listY + 60 + rows.reduce((sum, row) => sum + 62 + row.details.length * 26, 0) + 95;
  // Guard against browser canvas limits for unusually large plans.
  if (height > 16000) throw new Error("This plan is too large for one image. Use Save as PDF instead.");
  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
  const text = (value: string, x: number, y: number, font: string, color = "#203449") => { ctx.font = font; ctx.fillStyle = color; ctx.fillText(value, x, y); };
  ctx.fillStyle = "#173c64"; ctx.fillRect(0, 0, width, 145);
  text("F&M · ADAPTIVE COURSE PLANNER", padding, 45, "18px Arial", "#ffffff");
  text("Spring 2027 Prospective Course Plan", padding, 100, "36px Georgia", "#ffffff");
  text(`${courses.length} selected sections · All times Eastern`, padding, 185, "19px Arial");
  columns.forEach((items, day) => {
    const x = padding + day * (columnWidth + gap);
    text(days[day], x, 230, "bold 20px Arial");
    let y = 250;
    if (!items.length) text("No scheduled classes", x, y + 24, "17px Arial", "#6c7c89");
    items.forEach(({ course, item, title }) => {
      const cardHeight = 98 + title.length * 23;
      ctx.fillStyle = "#edf2f6"; ctx.fillRect(x, y, columnWidth, cardHeight);
      text(`${course.code}${item.type === "LAB" ? " · Lab" : ""}`, x + 14, y + 28, "bold 20px Arial");
      text(`${time(item.start)}–${time(item.end)}`, x + 14, y + 54, "17px Arial");
      title.forEach((line, index) => text(line, x + 14, y + 81 + index * 23, "17px Arial"));
      text(`CRN ${course.crn}`, x + 14, y + cardHeight - 12, "15px Arial", "#526b7d");
      y += cardHeight + 14;
    });
  });
  text("Selected courses", padding, listY + 25, "bold 25px Arial");
  let y = listY + 65;
  rows.forEach(({ course, details }) => {
    text(`${course.code}${course.section ? ` · Section ${course.section}` : ""} · CRN ${course.crn}`, padding, y, "bold 20px Arial");
    details.forEach((line, index) => text(line, padding, y + 30 + index * 26, "19px Arial"));
    y += 62 + details.length * 26;
  });
  text("Prospective plan only. Does not register you or confirm seat availability.", padding, height - 35, "17px Arial", "#627383");
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not create image.")), "image/png"));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fm-spring-2027-course-plan.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
