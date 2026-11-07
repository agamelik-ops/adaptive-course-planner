import type { Metadata } from "next";
import Planner from "./planner";

export const metadata: Metadata = {
  title: "Prospective Course Planner",
};

export default function PlannerPage() {
  return <Planner />;
}
