import { type AppliedMigration, type Migration, buildMigrationPlan } from './plan'

export type MigrationRunner = {
  migrations: readonly Migration[]
  loadApplied: () => Promise<AppliedMigration[]>
  execute: (migration: Migration, sequence: number) => Promise<void>
}

export async function runMigrations({ migrations, loadApplied, execute }: MigrationRunner): Promise<number> {
  const applied = await loadApplied()
  const plan = buildMigrationPlan(migrations, applied)

  for (const [index, migration] of plan.pending.entries()) {
    await execute(migration, applied.length + index + 1)
  }

  return plan.pending.length
}
