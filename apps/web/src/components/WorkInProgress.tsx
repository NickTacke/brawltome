"use client";

import { wipFeatures } from "@/lib/wip-features";

import { BrandSocialPills } from "./BrandSocialPills";
import { MobileFloatingMenuButton } from "./sidebar/MobileFloatingMenuButton";

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
    <>
      <div className="flex md:hidden">
        <MobileFloatingMenuButton />
      </div>
    <div className="flex min-h-[calc(100dvh-6.5rem)] flex-col items-center justify-center text-center sm:min-h-[calc(100dvh-7rem)] md:min-h-[calc(100dvh-4.5rem)]">
      <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-5">
        <Icon className="h-16 w-16" weight="Linear" />
      </div>

      <p className="text-muted-foreground mt-8 text-xs font-semibold uppercase tracking-widest">
        Coming soon
      </p>

      <h1 className="text-foreground mt-2 text-5xl font-bold tracking-tight">
        {feature.title}
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
    </>
  );
}
