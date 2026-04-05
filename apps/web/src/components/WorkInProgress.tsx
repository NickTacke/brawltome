"use client";

import { wipFeatures } from "@/lib/wip-features";

import { BrandSocialPills } from "./BrandSocialPills";

export type WipFeatureSlug = keyof typeof wipFeatures;

/**
 * Shared "coming soon" page for unreleased features. Marked "use client" so
 * its Solar icon value imports (via wipFeatures) stay out of the server graph
 * — importing them server-side triggers a createContext error during Next's
 * page config collection. The page stubs that render this component only pass
 * a plain string slug, keeping the server/client boundary clean.
 */
export function WorkInProgress({ slug }: { slug: WipFeatureSlug }) {
  const feature = wipFeatures[slug];
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
