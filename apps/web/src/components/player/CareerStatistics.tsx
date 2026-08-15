import type { PlayerCareerProfileContract, PlayerRankedProfileContract } from '@brawltome/contracts'
import { getLegendById, normalizeWeaponName } from '@brawltome/game-data'
import { Card, Progress } from '@brawltome/ui'
import { CombatCard } from './CombatCard'
import { LegendSection } from './LegendSection'
import { formatHours, getWeaponIcon } from './shared'

interface CareerStatisticsProps {
  career: PlayerCareerProfileContract | null
  currentSeason?: PlayerRankedProfileContract | null
  refreshing?: boolean
}

function observedDate(value: string): string {
  return value.slice(0, 10)
}

function Freshness({ career, refreshing }: { career: PlayerCareerProfileContract; refreshing: boolean }) {
  if (refreshing) {
    return (
      <p className="text-sm text-muted-foreground">
        Updating career statistics.{career.snapshot ? ' Last-known lifetime facts remain visible.' : ''}
      </p>
    )
  }
  if (!career.lastSuccessAt || career.freshness === 'unavailable') {
    return (
      <p className="text-sm text-muted-foreground">
        Unavailable. Lifetime career facts have not been successfully observed. Deep career sections are omitted. Last
        checked {observedDate(career.checkedAt)}.
      </p>
    )
  }
  if (career.snapshotSource === 'legacy-v2') {
    return (
      <p className="text-sm text-muted-foreground">
        Historical data from the previous service, observed {observedDate(career.lastSuccessAt)}. A live update will
        replace this snapshot when available.
      </p>
    )
  }
  if (career.freshness === 'stale') {
    return (
      <p className="text-sm text-muted-foreground">
        Update delayed. Last successful update {observedDate(career.lastSuccessAt)}.
      </p>
    )
  }
  return <p className="text-sm text-muted-foreground">Updated {observedDate(career.lastSuccessAt)}.</p>
}

export function CareerStatistics({ career, currentSeason = null, refreshing = false }: CareerStatisticsProps) {
  const snapshot = career?.snapshot
  const totalWeaponHeldTime = snapshot?.weapons.reduce((total, weapon) => total + weapon.heldTime, 0) ?? 0
  const legends =
    snapshot?.legends.map((legend) => {
      const reference = getLegendById(legend.legendId)
      return {
        ...legend,
        weaponOne: reference ? normalizeWeaponName(reference.weaponOne) : null,
        weaponTwo: reference ? normalizeWeaponName(reference.weaponTwo) : null,
        timeHeldWeaponOne: legend.weaponOne.heldTime,
        timeHeldWeaponTwo: legend.weaponTwo.heldTime,
        koWeaponOne: legend.weaponOne.kos,
        koWeaponTwo: legend.weaponTwo.kos,
        koUnarmed: legend.unarmed.kos,
        damageWeaponOne: legend.weaponOne.damage,
        damageWeaponTwo: legend.weaponTwo.damage,
        damageUnarmed: legend.unarmed.damage,
      }
    }) ?? []
  const rankedLegends = currentSeason?.snapshot?.rankedLegends ?? []

  return (
    <section aria-labelledby="career-statistics-heading" className="space-y-8">
      <div className="space-y-2">
        <h2 id="career-statistics-heading" className="text-2xl font-bold text-foreground">
          Career Statistics
        </h2>
        {career ? (
          <Freshness career={career} refreshing={refreshing} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Unavailable. Lifetime career facts have not been successfully observed. Deep career sections are omitted.
          </p>
        )}
      </div>

      {snapshot && (
        <>
          <CombatCard
            title="Career Combat Record"
            player={{
              ...snapshot.account,
              totalGames: snapshot.combat.games,
              totalWins: snapshot.combat.wins,
              statsLastUpdated: career?.lastSuccessAt,
            }}
          />

          <section aria-labelledby="career-weapons-heading" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h3 id="career-weapons-heading" className="text-2xl font-bold text-foreground">
                Career Weapon Usage
              </h3>
              <span className="font-mono text-sm text-muted-foreground">Weapons: {snapshot.weapons.length}</span>
            </div>
            {snapshot.weapons.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lifetime weapon usage was reported.</p>
            ) : (
              <Card className="divide-y divide-border overflow-hidden border-border">
                {snapshot.weapons.map((weapon) => {
                  const heldShare = totalWeaponHeldTime > 0 ? (weapon.heldTime / totalWeaponHeldTime) * 100 : 0
                  return (
                    <div key={weapon.weapon} className="flex items-center gap-4 p-4">
                      <img src={getWeaponIcon(weapon.weapon)} alt="" className="h-12 w-12 shrink-0 object-contain" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h4 className="font-bold text-foreground">{weapon.weapon}</h4>
                          <span className="font-mono text-sm text-foreground">
                            {formatHours(weapon.heldTime)} · {heldShare.toFixed(1)}%
                          </span>
                        </div>
                        <Progress value={heldShare} className="h-2 bg-muted" />
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{weapon.kos.toLocaleString('en-US')} KOs</span>
                          <span>{BigInt(weapon.damage).toLocaleString('en-US')} damage</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </Card>
            )}
          </section>

          <LegendSection
            allLegends={legends}
            rankedLegends={rankedLegends}
            rankedAvailable={Boolean(currentSeason?.snapshot)}
          />
        </>
      )}
    </section>
  )
}
