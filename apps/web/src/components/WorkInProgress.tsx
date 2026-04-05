import type { WipFeature } from "@/lib/wip-features";

import { BrandSocialPills } from "./BrandSocialPills";

/**
 * Shared "coming soon" page for unreleased features. Renders inside
 * SidebarLayout's non-home content wrapper, so users can still navigate away
 * via the sidebar — the component only owns its own centered content block.
 */
export function WorkInProgress({ feature }: { feature: WipFeature }) {
  const Icon = feature.icon;

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-5">
        <Icon className="h-16 w-16" weight="Linear" />
      </div>

      <h1 className="text-foreground mt-8 text-4xl font-bold tracking-tight">
        {feature.title} is coming soon
      </h1>

      <p className="text-muted-foreground mt-4 max-w-md text-xl">
        {feature.tagline}
      </p>

      <p className="text-muted-foreground mt-6 max-w-md text-base leading-relaxed">
        {feature.description}
      </p>

      <div className="mt-10">
        <BrandSocialPills />
      </div>
    </div>
  );
}
