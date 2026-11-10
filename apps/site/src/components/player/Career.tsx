import type { PlayerData } from '../../server/load-player'
import { MiniTable } from './MiniTable'
import { formatGrouped } from './player-format'
import { sectionBody, sectionTitle, statLabel } from './player-styles'
import { SplitRecord } from './SplitRecord'

type CareerSnapshot = NonNullable<NonNullable<PlayerData['career']>['snapshot']>

const emptyText = 'No games played yet'

const headlineFigure =
  'text-[1.75rem] leading-none font-black tracking-tight text-strong min-[400px]:text-[2.25rem] [@media(min-height:960px)]:text-[2.75rem] md:max-lg:text-[1.75rem]! lg:max-xl:text-[2.25rem]!'

function CareerTable({ snapshot: { account, combat } }: { snapshot: CareerSnapshot }) {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className={statLabel}>Games</div>
          <div className={`mt-1 ${headlineFigure}`}>{formatGrouped(combat.games)}</div>
        </div>
        <div className="w-[9.375rem] shrink-0 [&>[data-mini-table]]:w-full">
          <MiniTable
            rows={[
              { label: 'Level', value: String(account.level) },
              { label: 'XP', value: formatGrouped(account.xp) },
            ]}
          />
        </div>
      </div>
      <div className="mt-3">
        <SplitRecord standing={combat} emptyText={emptyText} />
      </div>
    </>
  )
}

export function Career({ snapshot }: { snapshot: CareerSnapshot | null }) {
  return (
    <section data-career>
      <h2 className={sectionTitle}>Career</h2>
      <div className={sectionBody}>
        {snapshot ? <CareerTable snapshot={snapshot} /> : <p className="text-sm text-soft">{emptyText}</p>}
      </div>
    </section>
  )
}
