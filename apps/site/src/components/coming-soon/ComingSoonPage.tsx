import { type ComingSoonSlug, comingSoonFeatures } from './features'

export function ComingSoonPage({ slug }: { slug: ComingSoonSlug }) {
  const { title, tagline, description, icon: Icon } = comingSoonFeatures[slug]

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <Icon className="size-14 text-soft" weight="Linear" aria-hidden="true" />
      <p className="mt-6 text-xs font-bold tracking-widest text-soft uppercase">Coming soon</p>
      <h1 className="mt-2 text-5xl font-black tracking-tight text-strong">{title}</h1>
      <p className="mt-4 max-w-md text-xl text-text">{tagline}</p>
      <p className="mt-4 max-w-md leading-relaxed text-soft">{description}</p>
    </div>
  )
}
