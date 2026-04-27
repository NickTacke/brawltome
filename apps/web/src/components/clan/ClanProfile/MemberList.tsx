'use client'

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@brawltome/ui'
import { Search } from 'lucide-react'
import { MemberRow } from './MemberRow'
import { type SortKey, filterMembers, paginateMembers, sortMembers } from './utils'

// biome-ignore lint/suspicious/noExplicitAny: dynamic API response
type Member = any

interface MemberListProps {
  members: Member[]
  totalClanXp: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  searchTerm: string
  onSearchChange: (value: string) => void
  sortBy: SortKey
  onSortChange: (value: SortKey) => void
}

export function MemberList({
  members,
  totalClanXp,
  page,
  pageSize,
  onPageChange,
  searchTerm,
  onSearchChange,
  sortBy,
  onSortChange,
}: MemberListProps) {
  const filtered = filterMembers(members, searchTerm)
  const sorted = sortMembers(filtered, sortBy)
  const totalPages = Math.ceil(sorted.length / pageSize)
  const visible = paginateMembers(sorted, page, pageSize)

  return (
    <div id="members">
      <Card className="bg-card/50 backdrop-blur-xs border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-yellow-500">&#127942;</span> Clan Members
          </CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-bold uppercase">Sort:</span>
              <Select
                value={sortBy}
                onValueChange={(v) => {
                  onSortChange(v as SortKey)
                  onPageChange(1)
                }}
              >
                <SelectTrigger className="w-[140px] font-bold h-9">
                  <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default" className="cursor-pointer">
                    Clan Rank
                  </SelectItem>
                  <SelectItem value="xp" className="cursor-pointer">
                    XP
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search members..."
                className="pl-8 h-9"
                value={searchTerm}
                onChange={(e) => {
                  onSearchChange(e.target.value)
                  onPageChange(1)
                }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-[60px] font-bold text-center">Rank</TableHead>
                <TableHead className="font-bold">Player</TableHead>
                <TableHead className="text-right font-bold">XP / Contribution</TableHead>
                <TableHead className="text-right font-bold hidden sm:table-cell">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No members found
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((member: Member) => (
                  <MemberRow key={member.brawlhallaId} member={member} totalClanXp={totalClanXp} />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        {totalPages > 1 && (
          <div className="p-4 border-t border-border flex justify-between items-center bg-muted/20">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
            >
              ← Prev
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-mono">Page</span>
              <Input
                key={page}
                defaultValue={page}
                className="h-8 w-16 text-center font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = Number.parseInt(e.currentTarget.value)
                    if (!Number.isNaN(val) && val >= 1 && val <= totalPages) onPageChange(val)
                  }
                }}
              />
              <span className="text-sm text-muted-foreground font-mono">of {totalPages}</span>
            </div>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              Next →
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
