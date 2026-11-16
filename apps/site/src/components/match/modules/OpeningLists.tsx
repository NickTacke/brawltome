import type { LeadKind, Moment } from '@brawltome/contracts'
import { useState } from 'react'
import { sectionTitle } from '../../player/player-styles'
import { OpeningDetail } from './OpeningDetail'
import { OpeningKindList } from './OpeningKindList'
import { readOpeningRecords } from './opening-records'

type OpeningListsProps = { moments: Moment[]; slot: number }

/**
 * The neutral game both ways round: how the picked player opened others up, and how they got opened up, each by how
 * the opening began. The names are the ones a review's stops carry.
 */
export function OpeningLists({ moments, slot }: OpeningListsProps) {
  const [selected, setSelected] = useState<LeadKind | null>(null)
  const records = readOpeningRecords(moments, slot)
  const record = records.find((entry) => entry.kind === selected)
  const toggle = (kind: LeadKind) => setSelected(kind === selected ? null : kind)

  return (
    <section aria-labelledby="openings">
      <h2 id="openings" className={sectionTitle}>
        Openings
      </h2>
      <div className="-mx-3 mt-2 grid gap-x-10 gap-y-4 sm:grid-cols-2">
        <OpeningKindList way="won" records={records} selected={selected} onSelect={toggle} />
        <OpeningKindList way="lost" records={records} selected={selected} onSelect={toggle} />
      </div>
      {record && (
        <div className="tile-detail-opening mt-3 grid">
          <div className="min-h-0 overflow-hidden">
            <div className="rounded-md bg-black/[0.14] p-4">
              <OpeningDetail record={record} onClose={() => setSelected(null)} />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
