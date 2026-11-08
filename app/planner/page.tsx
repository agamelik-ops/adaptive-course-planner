import { redirect } from "next/navigation";

// The planner lives on the homepage. This folder only holds the course data
// (courses.json / courses.ts); old /planner links are sent to the homepage.
export default function PlannerPage() {
  redirect("/");
}
