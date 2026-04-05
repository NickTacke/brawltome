import type { Metadata } from "next";

import { WorkInProgress } from "@/components/WorkInProgress";

export const metadata: Metadata = {
  title: "Tournaments — Coming Soon",
};

export default function Page() {
  return <WorkInProgress slug="tournaments" />;
}
