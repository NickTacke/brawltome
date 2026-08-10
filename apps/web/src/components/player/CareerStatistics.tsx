import type { PlayerCareerProfileContract } from '@brawltome/contracts'

interface CareerStatisticsProps {
  career: PlayerCareerProfileContract | null
  refreshing?: boolean
}

function observedDate(value: string): string {
  return value.slice(0, 10)
}

function Facts({ facts }: { facts: Array<[string, string | number]> }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {facts.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 font-mono font-semibold text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
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
  if (career.freshness === 'stale') {
    return (
      <p className="text-sm text-muted-foreground">
        Update delayed. Last successful update {observedDate(career.lastSuccessAt)}.
      </p>
    )
  }
  return <p className="text-sm text-muted-foreground">Updated {observedDate(career.lastSuccessAt)}.</p>
}

export function CareerStatistics({ career, refreshing = false }: CareerStatisticsProps) {
  const snapshot = career?.snapshot
  const totalWeaponHeldTime = snapshot?.weapons.reduce((total, weapon) => total + weapon.heldTime, 0) ?? 0

  return (
    <section aria-labelledby="career-statistics-heading" className="space-y-6">
      <div className="space-y-2">
        <h2 id="career-statistics-heading" className="text-2xl font-bold text-foreground">
          Career Statistics
        </h2>
        <p className="text-sm text-muted-foreground">
          Lifetime account, combat, legend, and weapon facts observed from complete career statistics.
        </p>
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
          <section aria-labelledby="account-statistics-heading" className="space-y-3">
            <h3 id="account-statistics-heading" className="text-xl font-bold text-foreground">
              Account Statistics
            </h3>
            <Facts
              facts={[
                ['Account level', snapshot.account.level],
                ['Account XP', snapshot.account.xp],
                ['Level progress', `${(snapshot.account.xpPercentage * 100).toFixed(1)}%`],
              ]}
            />
          </section>

          <section aria-labelledby="career-combat-heading" className="space-y-3">
            <h3 id="career-combat-heading" className="text-xl font-bold text-foreground">
              Career Combat Record
            </h3>
            <Facts
              facts={[
                ['Lifetime games', snapshot.combat.games],
                ['Lifetime wins', snapshot.combat.wins],
                ['Career match time', `${snapshot.combat.matchTime}s`],
                ['Bomb damage', snapshot.combat.damageBomb],
                ['Mine damage', snapshot.combat.damageMine],
                ['Spikeball damage', snapshot.combat.damageSpikeball],
                ['Sidekick damage', snapshot.combat.damageSidekick],
                ['Snowball hits', snapshot.combat.snowballHits],
                ['Bomb KOs', snapshot.combat.bombKos],
                ['Mine KOs', snapshot.combat.mineKos],
                ['Spikeball KOs', snapshot.combat.spikeballKos],
                ['Sidekick KOs', snapshot.combat.sidekickKos],
                ['Snowball KOs', snapshot.combat.snowballKos],
              ]}
            />
          </section>

          <section aria-labelledby="career-legends-heading" className="space-y-3">
            <h3 id="career-legends-heading" className="text-xl font-bold text-foreground">
              Career Legend Statistics
            </h3>
            {snapshot.legends.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lifetime legend observations were reported.</p>
            ) : (
              <div className="space-y-3">
                {snapshot.legends.map((legend) => (
                  <details key={legend.legendId} className="rounded-lg border border-border bg-card p-4">
                    <summary className="cursor-pointer font-semibold capitalize text-foreground">
                      {legend.legendNameKey}
                    </summary>
                    <div className="mt-4">
                      <Facts
                        facts={[
                          ['Legend level', legend.level],
                          ['Legend XP', legend.xp],
                          ['Lifetime games', legend.games],
                          ['Lifetime wins', legend.wins],
                          ['Match time', `${legend.matchTime}s`],
                          ['KOs', legend.kos],
                          ['Falls', legend.falls],
                          ['Suicides', legend.suicides],
                          ['Team KOs', legend.teamKos],
                          ['Damage dealt', legend.damageDealt],
                          ['Damage taken', legend.damageTaken],
                        ]}
                      />
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="career-weapons-heading" className="space-y-3">
            <h3 id="career-weapons-heading" className="text-xl font-bold text-foreground">
              Career Weapon Usage
            </h3>
            <p className="text-sm text-muted-foreground">
              Lifetime weapon usage from this player&apos;s complete career statistics.
            </p>
            {snapshot.weapons.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lifetime weapon usage was reported.</p>
            ) : (
              <div className="space-y-3">
                {snapshot.weapons.map((weapon) => {
                  const heldShare =
                    totalWeaponHeldTime > 0
                      ? `${((weapon.heldTime / totalWeaponHeldTime) * 100).toFixed(1)}%`
                      : 'Unavailable'
                  return (
                    <details key={weapon.weapon} className="rounded-lg border border-border bg-card p-4">
                      <summary className="cursor-pointer font-semibold text-foreground">{weapon.weapon}</summary>
                      <div className="mt-4">
                        <Facts
                          facts={[
                            ['Held time', `${weapon.heldTime}s`],
                            ['Held share', heldShare],
                            ['Exact damage', weapon.damage],
                            ['KOs', weapon.kos],
                          ]}
                        />
                      </div>
                    </details>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}
