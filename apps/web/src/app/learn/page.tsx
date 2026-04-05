import type { Metadata } from "next";

import { WorkInProgress } from "@/components/WorkInProgress";
import { wipFeatures } from "@/lib/wip-features";

export const metadata: Metadata = {
  title: `${wipFeatures.learn.title} — Coming Soon`,
};

export default function Page() {
  return <WorkInProgress feature={wipFeatures.learn} />;
}
