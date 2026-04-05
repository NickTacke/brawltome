import type { Metadata } from "next";

import { WorkInProgress } from "@/components/WorkInProgress";

export const metadata: Metadata = {
  title: "Matches — Coming Soon",
};

export default function Page() {
  return <WorkInProgress slug="matches" />;
}
