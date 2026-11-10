import { formatDay } from '../../lib'
import type { PatchNote } from '../../server/patch-feed'
import { SectionHeader, viewAllStyle } from './SectionHeader'

const patchNotesUrl = 'https://www.brawlhalla.com/news/patch-notes'

// the cards are 128px wide on phones and a third of the page from sm up
const imageSizes = '(min-width: 640px) 33vw, 128px'

function PatchArt({ note }: { note: PatchNote }) {
  const largest = note.images.at(-1)
  const sourceSet = note.images.map((image) => `${image.url} ${image.width}w`).join(', ')

  return (
    <div className="aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-raised sm:w-full">
      {largest && (
        <img
          src={largest.url}
          srcSet={sourceSet}
          sizes={imageSizes}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      )}
    </div>
  )
}

function PatchCard({ note }: { note: PatchNote }) {
  return (
    <a
      href={note.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-w-0 items-center gap-4 sm:block"
    >
      <PatchArt note={note} />
      <div className="min-w-0">
        <p className="line-clamp-2 font-semibold text-strong transition-colors group-hover:text-primary sm:mt-2.5">
          {note.headline}
        </p>
        <p className="mt-0.5 text-sm text-soft">
          {note.patch && `${note.patch} · `}
          {formatDay(note.publishedAt)}
        </p>
      </div>
    </a>
  )
}

export function PatchNews({ notes }: { notes: PatchNote[] }) {
  const viewAll = (
    <a href={patchNotesUrl} target="_blank" rel="noopener noreferrer" className={viewAllStyle}>
      View all →
    </a>
  )

  return (
    <section>
      <SectionHeader title="Patches" action={viewAll} />
      <div className="mt-4 grid gap-6 sm:grid-cols-3">
        {notes.map((note) => (
          <PatchCard key={note.url} note={note} />
        ))}
      </div>
      <p className="mt-4 text-xs text-soft">Patch art by Blue Mammoth Games.</p>
    </section>
  )
}
