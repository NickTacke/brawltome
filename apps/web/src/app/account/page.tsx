import type { Metadata } from "next";

import { WorkInProgress } from "@/components/WorkInProgress";

export const metadata: Metadata = {
  title: "Account — Coming Soon",
};

export default function Page() {
  return <WorkInProgress slug="account" />;
}
