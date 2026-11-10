import { ChevronDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { FilterSelect } from '../FilterSelect'
import { pauseScrollAnchoring } from '../scroll-anchoring'
import { sectionTitle } from './player-styles'
import { type FixedTeam, sortTeams, type TeamSortKey, teamSortOptions } from './side-summary'
import { TeamCard } from './TeamCard'

const collapsedTeams = 6

type CardGridProps = { teams: FixedTeam[]; ownId: number; continuesList?: boolean }

function CardGrid({ teams, ownId, continuesList = false }: CardGridProps) {
  const openingRowStyle = continuesList ? '' : 'first:border-t-0 md:nth-2:border-t-0'

  return (
    <ul className="grid grid-cols-1 gap-x-12 md:grid-cols-2">
      {teams.map((team) => (
        <li
          key={`${team.brawlhallaIdOne}:${team.brawlhallaIdTwo}:${team.region}`}
          className={`min-w-0 border-t border-line/30 ${openingRowStyle}`}
        >
          <TeamCard team={team} ownId={ownId} />
        </li>
      ))}
    </ul>
  )
}

function ShowMore({
  isExpanded,
  onToggle,
  children,
}: {
  isExpanded: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <>
      <div
        className={`grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        inert={!isExpanded}
      >
        <div className="-mx-3 min-h-0 overflow-hidden px-3">{children}</div>
      </div>
      <div className="mt-2 flex justify-center">
        <button
          type="button"
          data-teams-toggle
          aria-expanded={isExpanded}
          onClick={onToggle}
          className="flex min-h-6 items-center gap-1.5 text-sm font-semibold text-soft transition-colors hover:text-strong"
        >
          {isExpanded ? 'Show less' : 'Show more'}
          <ChevronDown
            aria-hidden="true"
            className={`size-4 transition-transform duration-300 ease-out motion-reduce:transition-none ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
    </>
  )
}

export function Teammates({ teams, playerId }: { teams: FixedTeam[]; playerId: number }) {
  const [sort, setSort] = useState<TeamSortKey>('elo')
  const [isExpanded, setIsExpanded] = useState(false)

  if (teams.length === 0) return null

  const sorted = sortTeams(teams, sort)
  const remaining = sorted.slice(collapsedTeams)

  function toggleExpanded() {
    pauseScrollAnchoring()
    setIsExpanded(!isExpanded)
  }

  return (
    <section data-teammates>
      <div className="flex items-center justify-between gap-4">
        <h2 className={sectionTitle}>2v2 Teams</h2>
        <FilterSelect
          label="Sort"
          value={sort}
          options={teamSortOptions}
          onChange={(value) => setSort(value as TeamSortKey)}
        />
      </div>
      <div className="mt-1.5">
        <CardGrid teams={sorted.slice(0, collapsedTeams)} ownId={playerId} />
        {remaining.length > 0 && (
          <ShowMore isExpanded={isExpanded} onToggle={toggleExpanded}>
            <CardGrid teams={remaining} ownId={playerId} continuesList />
          </ShowMore>
        )}
      </div>
    </section>
  )
}
