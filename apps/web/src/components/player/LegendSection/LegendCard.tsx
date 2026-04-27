import { formatNum } from '@/lib/utils'
import { normalizeWeaponName } from '@brawltome/shared'
import { Avatar, AvatarFallback, AvatarImage, Badge } from '@brawltome/ui'
import {
  type PlayerData,
  WinLossBar,
  calculateEloReset,
  formatCompact,
  formatHours,
  getRankBanner,
  parseNum,
} from '../shared'
import { WeaponStatRow } from './WeaponStatRow'

interface LegendCardProps {
  legend: PlayerData
  rankedLegend: PlayerData | undefined
  isExpanded: boolean
  hasOpened: boolean
  onToggle: (id: number) => void
}

export function LegendCard({ legend, rankedLegend, isExpanded, hasOpened, onToggle }: LegendCardProps) {
  const wr = legend.games > 0 ? (legend.wins / legend.games) * 100 : 0

  return (
    <div
      className={`transition-all duration-200 cursor-pointer hover:bg-accent/30 ${isExpanded ? 'bg-accent/20' : ''}`}
      // biome-ignore lint/a11y/useSemanticElements: complex expandable card layout
      role="button"
      tabIndex={0}
      onClick={() => onToggle(legend.legendId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onToggle(legend.legendId)
      }}
    >
      <div className="p-4 relative overflow-hidden">
        <div className="flex items-center gap-4 relative z-10">
          <Avatar className="w-12 h-12 rounded-lg shadow-sm shrink-0">
            <AvatarImage
              src={`/images/legends/avatars/${legend.legendNameKey}.png`}
              alt={legend.legendNameKey}
              className="object-cover object-top"
              loading="lazy"
            />
            <AvatarFallback className="bg-muted text-lg font-bold text-muted-foreground capitalize rounded-md">
              {legend.legendNameKey?.[0] || '?'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold capitalize truncate text-sm">{legend.legendNameKey}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground font-mono">
              <span>{formatNum(legend.xp)} XP</span>
              <span className="opacity-30">&bull;</span>
              <span className={wr > 50 ? 'text-success font-bold' : ''}>{wr.toFixed(0)}% WR</span>
              <span className="opacity-30">&bull;</span>
              <span>{formatHours(parseNum(legend.matchTime))}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 sm:hidden">
              <Badge variant="secondary" className="text-xs font-mono px-2 py-1 h-7">
                Lvl {legend.level}
              </Badge>
              {rankedLegend && !isExpanded && (
                <Badge
                  variant="outline"
                  className="text-xs font-mono text-muted-foreground whitespace-nowrap px-2 py-1 h-7"
                >
                  {rankedLegend.tier} &bull; {rankedLegend.rating}
                </Badge>
              )}
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <Badge variant="secondary" className="text-xs font-mono px-2 py-1 h-7">
              Lvl {legend.level}
            </Badge>
            {rankedLegend && !isExpanded && (
              <Badge
                variant="outline"
                className="text-xs font-mono text-muted-foreground whitespace-nowrap px-2 py-1 h-7"
              >
                {rankedLegend.tier} &bull; {rankedLegend.rating}
              </Badge>
            )}
          </div>
        </div>

        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out relative z-10 ${
            isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
          aria-hidden={!isExpanded}
        >
          <div className="min-h-0 overflow-hidden">
            {hasOpened && <LegendCardExpanded legend={legend} rankedLegend={rankedLegend} />}
          </div>
        </div>
      </div>
    </div>
  )
}

interface LegendCardExpandedProps {
  legend: PlayerData
  rankedLegend: PlayerData | undefined
}

function LegendCardExpanded({ legend, rankedLegend }: LegendCardExpandedProps) {
  const matchTime = parseNum(legend.matchTime)
  const legendGames = parseNum(legend.games)
  const legendWins = parseNum(legend.wins)
  const legendKOs = parseNum(legend.kos)
  const legendFalls = parseNum(legend.falls)
  const legendSuicides = parseNum(legend.suicides)
  const legendDmgDealt = parseNum(legend.damageDealt)
  const legendDmgTaken = parseNum(legend.damageTaken)
  const legendWinrate = legendGames > 0 ? (legendWins / legendGames) * 100 : 0

  const dpsDealt = matchTime > 0 ? legendDmgDealt / matchTime : 0
  const avgKOsPerGame = legendGames > 0 ? legendKOs / legendGames : 0
  const avgFallsPerGame = legendGames > 0 ? legendFalls / legendGames : 0
  const kdRatio = legendFalls > 0 ? legendKOs / legendFalls : legendKOs
  const dmgRatio = legendDmgDealt + legendDmgTaken > 0 ? (legendDmgDealt / (legendDmgDealt + legendDmgTaken)) * 100 : 50

  const weaponOneTime = parseNum(legend.timeHeldWeaponOne)
  const weaponTwoTime = parseNum(legend.timeHeldWeaponTwo)
  const unarmedTime = Math.max(0, matchTime - weaponOneTime - weaponTwoTime)
  const totalWeaponTime = weaponOneTime + weaponTwoTime + unarmedTime

  const weaponOneKOs = parseNum(legend.koWeaponOne)
  const weaponTwoKOs = parseNum(legend.koWeaponTwo)
  const unarmedKOs = parseNum(legend.koUnarmed)
  const totalWeaponKOs = weaponOneKOs + weaponTwoKOs + unarmedKOs

  const weaponOneDmg = parseNum(legend.damageWeaponOne)
  const weaponTwoDmg = parseNum(legend.damageWeaponTwo)
  const unarmedDmg = parseNum(legend.damageUnarmed)
  const totalWeaponDmg = weaponOneDmg + weaponTwoDmg + unarmedDmg

  const weaponOneName = legend.weaponOne ? normalizeWeaponName(legend.weaponOne) : 'Weapon 1'
  const weaponTwoName = legend.weaponTwo ? normalizeWeaponName(legend.weaponTwo) : 'Weapon 2'
  const weaponDistribution = [
    { name: weaponOneName, kos: weaponOneKOs, dmg: weaponOneDmg, time: weaponOneTime },
    { name: weaponTwoName, kos: weaponTwoKOs, dmg: weaponTwoDmg, time: weaponTwoTime },
    { name: 'Unarmed', kos: unarmedKOs, dmg: unarmedDmg, time: unarmedTime },
  ].filter((w) => w.kos > 0 || w.dmg > 0 || w.time > 0)

  return (
    <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300 relative z-10 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-0">
        <div className="space-y-3 md:pr-4 md:border-r md:border-border/30">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Overall Stats
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-foreground">{formatNum(legendGames)}</span>
              <span className="text-xs text-muted-foreground">games</span>
              <span className="text-muted-foreground/30 mx-1">&bull;</span>
              <span className="text-sm font-mono text-muted-foreground">{formatHours(matchTime)}</span>
            </div>
            <WinLossBar percent={legendWinrate} className="h-2" />
            <div className="flex justify-between text-[10px] font-bold">
              <span className="text-foreground">
                {formatNum(legendWins)}W{' '}
                <span className="font-normal text-muted-foreground">({legendWinrate.toFixed(1)}%)</span>
              </span>
              <span className="text-foreground">
                {formatNum(legendGames - legendWins)}L{' '}
                <span className="font-normal text-muted-foreground">({(100 - legendWinrate).toFixed(1)}%)</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
              <div className="flex justify-between items-start mb-1">
                <div className="text-[9px] text-muted-foreground uppercase">KOs / Falls</div>
                <div className="text-[10px] font-bold text-foreground/70">{kdRatio.toFixed(2)} K/D</div>
              </div>
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-lg font-black text-success">{formatNum(legendKOs)}</div>
                  <div className="text-[8px] text-muted-foreground">KOs</div>
                </div>
                <span className="text-muted-foreground/30 text-lg">/</span>
                <div>
                  <div className="text-lg font-black text-danger">{formatNum(legendFalls)}</div>
                  <div className="text-[8px] text-muted-foreground">falls</div>
                </div>
              </div>
              {legendSuicides > 0 && (
                <div className="text-[9px] text-muted-foreground mt-1">{formatNum(legendSuicides)} suicides</div>
              )}
            </div>
            <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
              <div className="flex justify-between items-start mb-1">
                <div className="text-[9px] text-muted-foreground uppercase">Damage</div>
                <div className="text-[10px] font-bold text-foreground/70">{dmgRatio.toFixed(0)}% dealt</div>
              </div>
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-lg font-black text-success">{formatCompact(legendDmgDealt)}</div>
                  <div className="text-[8px] text-muted-foreground">dealt</div>
                </div>
                <span className="text-muted-foreground/30 text-lg">/</span>
                <div>
                  <div className="text-lg font-black text-danger">{formatCompact(legendDmgTaken)}</div>
                  <div className="text-[8px] text-muted-foreground">taken</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1 text-center">
            <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
              <div className="text-sm font-black text-foreground">{avgKOsPerGame.toFixed(1)}</div>
              <div className="text-[8px] text-muted-foreground">KOs/game</div>
            </div>
            <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
              <div className="text-sm font-black text-foreground">{avgFallsPerGame.toFixed(1)}</div>
              <div className="text-[8px] text-muted-foreground">Falls/game</div>
            </div>
            <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
              <div className="text-sm font-black text-foreground">
                {legendKOs > 0 ? formatNum(Math.round(legendDmgDealt / legendKOs)) : '-'}
              </div>
              <div className="text-[8px] text-muted-foreground">Dmg/KO</div>
            </div>
            <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
              <div className="text-sm font-black text-foreground">{dpsDealt.toFixed(1)}</div>
              <div className="text-[8px] text-muted-foreground">DPS</div>
            </div>
          </div>
        </div>

        <div className="space-y-3 md:pl-4">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            Ranked Season
          </div>

          {rankedLegend ? <RankedSeasonPanel rankedLegend={rankedLegend} /> : <UnrankedPanel />}
        </div>
      </div>

      {weaponDistribution.length > 0 && (
        <div className="pt-4 border-t border-border/30">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
            Weapon Distribution
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {weaponDistribution.map((w) => (
              <WeaponStatRow
                key={w.name}
                name={w.name}
                kos={w.kos}
                dmg={w.dmg}
                time={w.time}
                totalKOs={totalWeaponKOs}
                totalDmg={totalWeaponDmg}
                totalTime={totalWeaponTime}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RankedSeasonPanel({ rankedLegend }: { rankedLegend: PlayerData }) {
  const rankedWinrate = rankedLegend.games > 0 ? (rankedLegend.wins / rankedLegend.games) * 100 : 0
  return (
    <div className="space-y-3 mt-7">
      <div className="flex gap-3">
        <div className="w-16 sm:w-18 shrink-0 mb-5">
          <img
            src={getRankBanner(rankedLegend.tier)}
            alt={rankedLegend.tier}
            className="w-full h-auto object-contain drop-shadow-lg"
          />
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-[10px] sm:text-xs font-bold text-muted-foreground">{rankedLegend.tier}</div>
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-2xl sm:text-3xl font-black text-foreground tracking-tight leading-none">
              {rankedLegend.rating}
            </span>
            <span className="text-xl sm:text-2xl font-bold text-muted-foreground/30 leading-none">/</span>
            <span className="text-xl sm:text-2xl font-bold text-muted-foreground/50 leading-none">
              {rankedLegend.peakRating}
            </span>
            <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-wider ml-0.5">Peak</span>
          </div>
          <WinLossBar percent={rankedWinrate} className="h-2" />
          <div className="flex justify-between text-[10px] font-bold">
            <span className="text-foreground">
              {rankedLegend.wins}W{' '}
              <span className="font-normal text-muted-foreground">({rankedWinrate.toFixed(1)}%)</span>
            </span>
            <span className="text-foreground">
              {rankedLegend.games - rankedLegend.wins}L{' '}
              <span className="font-normal text-muted-foreground">({(100 - rankedWinrate).toFixed(1)}%)</span>
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 text-center hover:bg-background/50 transition-colors">
          <div className="text-lg font-black text-foreground">{formatNum(rankedLegend.games)}</div>
          <div className="text-[8px] text-muted-foreground uppercase">Games</div>
        </div>
        <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 text-center hover:bg-background/50 transition-colors">
          <div className="text-lg font-black text-foreground">{calculateEloReset(rankedLegend.rating)}</div>
          <div className="text-[8px] text-muted-foreground uppercase">Elo Reset</div>
        </div>
      </div>
    </div>
  )
}

function UnrankedPanel() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-16 sm:w-20 opacity-30 mb-3">
        <img src="/images/banners/Unranked.png" alt="Unranked" className="w-full h-auto object-contain" />
      </div>
      <div className="text-sm text-muted-foreground">No ranked games this season</div>
      <div className="text-[10px] text-muted-foreground/50 mt-1">Play ranked to see stats here</div>
    </div>
  )
}
