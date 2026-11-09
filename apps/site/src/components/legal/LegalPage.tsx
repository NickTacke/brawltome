import type { ReactNode } from 'react'

export type LegalSection = { title: string; body: ReactNode }

type LegalPageProps = { title: string; updated: string; intro: ReactNode; sections: LegalSection[] }

export function LegalPage({ title, updated, intro, sections }: LegalPageProps) {
  return (
    <article className="mx-auto max-w-2xl">
      <h1 className="text-4xl font-black tracking-tight text-strong">{title}</h1>
      <p className="mt-2 text-sm text-soft">Last updated {updated}</p>
      <div className="mt-6 text-body leading-relaxed text-text">{intro}</div>
      <div className="mt-8 divide-y divide-line/50">
        {sections.map(({ title: sectionTitle, body }) => (
          <section key={sectionTitle} className="py-6 first:pt-0">
            <h2 className="text-lg font-bold text-strong">{sectionTitle}</h2>
            <div className="mt-2 space-y-3 leading-relaxed text-text [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
              {body}
            </div>
          </section>
        ))}
      </div>
    </article>
  )
}
