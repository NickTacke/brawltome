import type { Metadata } from "next";

import { WorkInProgress } from "@/components/WorkInProgress";
import { wipFeatures } from "@/lib/wip-features";

export const metadata: Metadata = {
  title: `${wipFeatures.stats.title} — Coming Soon`,
};

export default function Page() {
  return <WorkInProgress feature={wipFeatures.stats} />;
}
