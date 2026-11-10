import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { formatDay, formatWhole } from '../../lib'
import { FilterSelect } from '../FilterSelect'
import { Pager } from '../Pager'
import { stripedRowStyle, stripedTableStyle } from '../table-styles'
import { LegendAvatar } from './LegendAvatar'
import { PlayerLink } from './PlayerLink'
import { RoleIcon } from './RoleIcon'
import {
  countByRole,
  filterMembers,
  type RankedMember,
  type RoleFilter,
  type RosterSort,
  roleGroups,
  type SortKey,
  sortMembers,
} from './roster'

const pageSize = 30
const columnLabelStyle = 'flex h-4 items-center gap-1 text-[0.6875rem] leading-none font-bold tracking-wide uppercase'

function Role({ member }: { member: RankedMember }) {
  return (
    <span className="inline-flex items-center gap-2 text-soft">
      <span className="flex size-4 items-center justify-center">
        <RoleIcon group={member.roleGroup} />
      </span>
      {member.rank ?? 'Unknown'}
    </span>
  )
}

type HeaderProps = {
  sortKey: SortKey
  sort: RosterSort
  onSort: (key: SortKey) => void
  alignRight?: boolean
  className?: string
  children: ReactNode
}

function SortableHeader({ sortKey, sort, onSort, alignRight, className = '', children }: HeaderProps) {
  const isActive = sort.key === sortKey
  const SortIcon = sort.descending ? ChevronDown : ChevronUp
  const direction = sort.descending ? 'descending' : 'ascending'

  return (
    <th scope="col" aria-sort={isActive ? direction : 'none'} className={`h-10 px-3 align-middle ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`${columnLabelStyle} transition-colors hover:text-strong ${isActive ? 'text-strong' : 'text-soft'} ${alignRight ? 'w-full flex-row-reverse' : ''}`}
      >
        {children}
        <SortIcon className={`size-3.5 ${isActive ? '' : 'invisible'}`} aria-hidden="true" />
      </button>
    </th>
  )
}

function MemberRow({ member }: { member: RankedMember }) {
  return (
    <tr className={stripedRowStyle}>
      <td className="max-w-0 pr-3 pl-3">
        <div className="flex items-center gap-3">
          <LegendAvatar legend={member.mainLegend} />
          <div className="min-w-0">
            <PlayerLink
              playerId={member.brawlhallaId}
              className="block truncate text-base font-semibold text-strong transition-colors group-hover:text-primary after:absolute after:inset-0"
            >
              {member.displayName}
            </PlayerLink>
            <div className="mt-0.5 text-xs sm:hidden">
              <Role member={member} />
            </div>
          </div>
        </div>
      </td>
      <td className="hidden w-32 px-3 sm:table-cell">
        <Role member={member} />
      </td>
      <td className="hidden w-24 px-3 text-right font-mono text-soft md:table-cell">
        {member.elo === null ? '—' : formatWhole(member.elo)}
      </td>
      <td className="w-[8.75rem] pr-3 pl-3 text-right font-mono font-semibold text-strong sm:w-32">
        {formatWhole(member.xp)}
        {member.elo !== null && (
          <div className="mt-0.5 text-xs font-normal text-soft md:hidden">{formatWhole(member.elo)} 1v1 Elo</div>
        )}
      </td>
      <td className="hidden w-[9.75rem] pr-3 pl-3 text-right text-soft sm:table-cell">{formatDay(member.joinDate)}</td>
    </tr>
  )
}

function roleFilterOptions(members: RankedMember[]) {
  const counts = countByRole(members)
  const presentRoles = roleGroups.filter(({ group }) => counts[group] > 0)

  return [
    { value: 'all', label: 'All', detail: formatWhole(members.length) },
    ...presentRoles.map(({ group, label }) => ({ value: group, label, detail: formatWhole(counts[group]) })),
  ]
}

type RosterHeadingProps = {
  members: RankedMember[]
  role: RoleFilter
  search: string
  onRole: (role: RoleFilter) => void
  onSearch: (search: string) => void
}

function RosterHeading({ members, role, search, onRole, onSearch }: RosterHeadingProps) {
  return (
    <div className="flex flex-col gap-4 pb-4 lg:flex-row lg:items-center lg:justify-between">
      <h2 id="members-heading" className="text-xl font-bold text-strong">
        Roster
      </h2>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <FilterSelect
          label="Role"
          value={role}
          options={roleFilterOptions(members)}
          onChange={(next) => onRole(next as RoleFilter)}
        />
        <label className="relative block w-full shrink-0 sm:w-56">
          <span className="sr-only">Search members</span>
          <Search className="pointer-events-none absolute top-2.5 left-2 size-4 text-soft" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search members..."
            className="h-9 w-full rounded-control border border-line bg-transparent pr-3 pl-8 text-sm placeholder:text-soft"
          />
        </label>
      </div>
    </div>
  )
}

function RosterTable({
  visible,
  sort,
  onSort,
}: {
  visible: RankedMember[]
  sort: RosterSort
  onSort: (key: SortKey) => void
}) {
  return (
    <table className={stripedTableStyle}>
      <thead className="border-y border-line/40">
        <tr>
          <SortableHeader sortKey="name" sort={sort} onSort={onSort} className="text-left">
            Player
          </SortableHeader>
          <SortableHeader sortKey="role" sort={sort} onSort={onSort} className="hidden w-32 text-left sm:table-cell">
            Role
          </SortableHeader>
          <SortableHeader
            sortKey="elo"
            sort={sort}
            onSort={onSort}
            alignRight
            className="hidden w-24 text-right md:table-cell"
          >
            1v1 Elo
          </SortableHeader>
          <SortableHeader
            sortKey="xp"
            sort={sort}
            onSort={onSort}
            alignRight
            className="w-[8.75rem] text-right sm:w-32"
          >
            XP
          </SortableHeader>
          <SortableHeader
            sortKey="joined"
            sort={sort}
            onSort={onSort}
            alignRight
            className="hidden w-[9.75rem] text-right sm:table-cell"
          >
            Joined
          </SortableHeader>
        </tr>
      </thead>
      <tbody>
        {visible.map((member) => (
          <MemberRow key={member.brawlhallaId} member={member} />
        ))}
        {visible.length === 0 && (
          <tr>
            <td colSpan={5} className="py-8 text-center text-soft">
              No members found
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function useRosterPage() {
  const [page, setPage] = useState(1)
  const pagerRef = useRef<HTMLDivElement>(null)
  const pagerTopBeforeChange = useRef<number | null>(null)

  // on phones a short last page changes the height, so scroll to keep the pager under the finger
  // biome-ignore lint/correctness/useExhaustiveDependencies: page is the trigger, the refs hold the positions
  useLayoutEffect(() => {
    const previousTop = pagerTopBeforeChange.current

    pagerTopBeforeChange.current = null

    if (previousTop === null || !pagerRef.current) return

    window.scrollBy(0, pagerRef.current.getBoundingClientRect().top - previousTop)
  }, [page])

  function changePage(nextPage: number) {
    pagerTopBeforeChange.current = pagerRef.current?.getBoundingClientRect().top ?? null
    setPage(nextPage)
  }

  return { page, pagerRef, changePage, resetPage: () => setPage(1) }
}

export function MemberTable({ members }: { members: RankedMember[] }) {
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<RoleFilter>('all')
  const [sort, setSort] = useState<RosterSort>({ key: 'role', descending: true })
  const { page, pagerRef, changePage, resetPage } = useRosterPage()

  const sorted = sortMembers(filterMembers(members, role, search), sort)
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const visible = sorted.slice((page - 1) * pageSize, page * pageSize)

  function changeSort(key: SortKey) {
    resetPage()

    setSort((current) =>
      current.key === key ? { key, descending: !current.descending } : { key, descending: key !== 'name' },
    )
  }

  function changeRole(nextRole: RoleFilter) {
    resetPage()
    setRole(nextRole)
  }

  function changeSearch(nextSearch: string) {
    resetPage()
    setSearch(nextSearch)
  }

  return (
    <section aria-labelledby="members-heading">
      <RosterHeading members={members} role={role} search={search} onRole={changeRole} onSearch={changeSearch} />

      {/* a short last page keeps the full height on larger screens, so the pager never moves under the cursor */}
      <div className={pages > 1 ? 'sm:min-h-[calc(2.625rem+30*3rem)]' : undefined}>
        <RosterTable visible={visible} sort={sort} onSort={changeSort} />
      </div>

      {sorted.length > pageSize && (
        <div ref={pagerRef}>
          <Pager
            label="Roster"
            page={page}
            pages={pages}
            pageSize={pageSize}
            total={sorted.length}
            onPage={changePage}
          />
        </div>
      )}
    </section>
  )
}
