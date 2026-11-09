import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { buildMigrationPlan, migratePostgres } from '@brawltome/foundation'
import { queueModule } from '@brawltome/queue'
import postgres from 'postgres'
import { orderedMigrations } from '../src/inventories'
import { deployedHistory } from './fixtures/deployed-history'

const connectionString = process.env.DATABASE_URL

type HistoryRow = { identity: string; checksum: string }

function toHistoryRow({ identity, checksum }: HistoryRow): HistoryRow {
  return { identity, checksum }
}

function isQueueRow({ identity }: HistoryRow): boolean {
  return identity.startsWith('refresh-operations/')
}

// production recorded these after deployedOrder was frozen, while the module was still named refresh-operations
const rowsRecordedAfterDeployedOrder: HistoryRow[] = [
  { identity: 'refresh-operations/0027', checksum: 'eb3e668aa092c891fa6d8dbc1a9c2ac4898c0e9a345efa90c4a9ea85526009ca' },
  { identity: 'refresh-operations/0028', checksum: '7b6a49cfd1afceed8df65084d2b43ac0fc2d417500e999e43bbddb8e0c5aca59' },
  { identity: 'refresh-operations/0029', checksum: 'c25b822d0ef8d97ee4a7f829999d635586e173d919cad0ec7be6f3896adc2954' },
  { identity: 'refresh-operations/0030', checksum: '1a61ff370d84645ea2a96b840f42360946db258adba6216fa6eac51b8b09ecf0' },
  { identity: 'refresh-operations/0031', checksum: '146aef39269ea083a9b159690a79570dd47086be58026106cf26ba0938fda8ea' },
]

const queueRowsBeforeRename = [
  ...deployedHistory.filter(isQueueRow).map(toHistoryRow),
  ...rowsRecordedAfterDeployedOrder,
]

describe('renaming the refresh-operations module to queue', () => {
  test('keeps the identity and checksum of every migration recorded under the old name', () => {
    const currentRows = queueModule.migrations.slice(0, queueRowsBeforeRename.length).map(toHistoryRow)

    expect(queueModule.name).toBe('queue')
    expect(currentRows).toEqual(queueRowsBeforeRename)
  })

  test('plans nothing for a database whose history was recorded under the old name', () => {
    const laterRows = orderedMigrations.slice(deployedHistory.length).map(toHistoryRow)
    const history = [...deployedHistory.map(toHistoryRow), ...laterRows]

    expect(buildMigrationPlan(orderedMigrations, history).pending).toEqual([])
  })
})

describe.skipIf(!connectionString)('a migrated database after renaming the queue module', () => {
  test('applies nothing and still records its queue migrations under the old prefix', async () => {
    const databaseName = `brawltome_queue_rename_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    const databaseUrl = new URL(connectionString as string)

    adminUrl.pathname = '/postgres'
    databaseUrl.pathname = `/${databaseName}`

    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)

    try {
      expect(await migratePostgres(databaseUrl.toString(), orderedMigrations)).toBe(orderedMigrations.length)
      expect(await migratePostgres(databaseUrl.toString(), orderedMigrations)).toBe(0)

      const client = postgres(databaseUrl.toString(), { max: 1 })

      try {
        const rows = await client<HistoryRow[]>`
          SELECT identity, trim(checksum) AS checksum FROM brawltome_migrations.history ORDER BY identity
        `

        expect(rows.filter(isQueueRow).slice(0, queueRowsBeforeRename.length).map(toHistoryRow)).toEqual(
          queueRowsBeforeRename,
        )
      } finally {
        await client.end()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  }, 30_000)
})
