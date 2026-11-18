import type { LeadKind, Moment } from '@brawltome/contracts'
import { useState } from 'react'
import { sectionTitle } from '../../player/player-styles'
import { OpeningDetail } from './OpeningDetail'
import { OpeningKindList, type OpeningWay } from './OpeningKindList'
import { readOpeningRecords } from './opening-records'

type OpeningListsProps = { moments: Moment[]; slot: number }

// the kind opened, and the list it was opened from
type Opened = { kind: LeadKind; way: OpeningWay }

// under both lists where they stand side by side; on a phone, where they stand one above the other, right under the
// list it was opened from. inside the lists' grid, so mx-3 and -mt-1 undo its -mx-3 and the extra row gap
const detailPlace = 'tile-detail-opening mx-3 -mt-1 grid sm:order-last sm:col-span-2'

/**
 * The neutral game both ways round: how the picked player opened others up, and how they got opened up, each by how
 * the opening began. The names are the ones a review's stops carry.
 */
export function OpeningLists({ moments, slot }: OpeningListsProps) {
  const [opened, setOpened] = useState<Opened | null>(null)
  const records = readOpeningRecords(moments, slot)
  const record = records.find((entry) => entry.kind === opened?.kind)
  const toggle = (kind: LeadKind, way: OpeningWay) => setOpened(kind === opened?.kind ? null : { kind, way })

  const detail = record ? (
    <div className={detailPlace}>
      <div className="min-h-0 overflow-hidden">
        <div className="rounded-md bg-black/[0.14] p-4">
          <OpeningDetail record={record} onClose={() => setOpened(null)} />
        </div>
      </div>
    </div>
  ) : null

  return (
    <section aria-labelledby="openings">
      <h2 id="openings" className={sectionTitle}>
        Openings
      </h2>
      <div className="-mx-3 mt-2 grid gap-x-10 gap-y-4 sm:grid-cols-2">
        <OpeningKindList
          way="won"
          records={records}
          selected={opened?.kind ?? null}
          onSelect={(kind) => toggle(kind, 'won')}
        />
        {opened?.way === 'won' ? detail : null}
        <OpeningKindList
          way="lost"
          records={records}
          selected={opened?.kind ?? null}
          onSelect={(kind) => toggle(kind, 'lost')}
        />
        {opened?.way === 'lost' ? detail : null}
      </div>
    </section>
  )
}
