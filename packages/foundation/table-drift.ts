import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core'
import type { Database } from './database'

type ColumnShape = {
  type: string
  isNotNull: boolean
}

type DatabaseColumnRow = {
  name: string
  type: string
  isNotNull: boolean
}

const defaultSchema = 'public'
// timestamp precision defaults to 6, so naming it changes nothing
const defaultTimePrecisionPattern = /^timestamp\(6\)/

/**
 * Throws one error listing every way the drizzle tables differ from the migrated database. Compares schema, table,
 * column names, column types and nullability; defaults, checks and indexes belong to the migrations.
 */
export async function expectTablesMatchDatabase(database: Database, tables: readonly PgTable[]): Promise<void> {
  const differences: string[] = []

  for (const table of tables) {
    differences.push(...(await tableDifferences(database, table)))
  }

  if (differences.length > 0) {
    throw new Error(`drizzle tables do not match the database:\n${differences.map((line) => `- ${line}`).join('\n')}`)
  }
}

async function tableDifferences(database: Database, table: PgTable): Promise<string[]> {
  const config = getTableConfig(table)
  const label = `${config.schema ?? defaultSchema}.${config.name}`

  const databaseColumns = await readDatabaseColumns(database, config.schema ?? defaultSchema, config.name)

  if (databaseColumns.size === 0) {
    return [`${label}: table is not in the database`]
  }

  const drizzleColumns = new Map(config.columns.map((column) => [column.name, column]))

  return [
    ...columnNameDifferences(label, databaseColumns, drizzleColumns),
    ...columnShapeDifferences(label, databaseColumns, drizzleColumns),
  ]
}

// pg_catalog rather than information_schema: format_type keeps array element lengths and precision, and the
// catalog lists every column whatever the role may read
async function readDatabaseColumns(
  database: Database,
  schema: string,
  tableName: string,
): Promise<Map<string, ColumnShape>> {
  const rows = await database.sql<DatabaseColumnRow[]>`
    SELECT
      attribute.attname AS name,
      format_type(attribute.atttypid, attribute.atttypmod) AS type,
      attribute.attnotnull AS "isNotNull"
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = ${schema}
      AND relation.relname = ${tableName}
      AND relation.relkind IN ('r', 'p')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY attribute.attnum
  `

  return new Map(rows.map((row) => [row.name, { type: canonicalDatabaseType(row.type), isNotNull: row.isNotNull }]))
}

function columnNameDifferences(
  label: string,
  databaseColumns: Map<string, ColumnShape>,
  drizzleColumns: Map<string, PgColumn>,
): string[] {
  const onlyInDatabase = [...databaseColumns.keys()].filter((name) => !drizzleColumns.has(name))
  const onlyInDrizzle = [...drizzleColumns.keys()].filter((name) => !databaseColumns.has(name))

  return [
    ...onlyInDatabase.map((name) => `${label}: column ${name} is in the database but not in drizzle`),
    ...onlyInDrizzle.map((name) => `${label}: column ${name} is in drizzle but not in the database`),
  ]
}

function columnShapeDifferences(
  label: string,
  databaseColumns: Map<string, ColumnShape>,
  drizzleColumns: Map<string, PgColumn>,
): string[] {
  const differences: string[] = []

  for (const [name, databaseColumn] of databaseColumns) {
    const drizzleColumn = drizzleColumns.get(name)

    if (!drizzleColumn) continue

    differences.push(...singleColumnDifferences(`${label}: column ${name}`, databaseColumn, drizzleColumn))
  }

  return differences
}

function singleColumnDifferences(prefix: string, databaseColumn: ColumnShape, drizzleColumn: PgColumn): string[] {
  return [
    ...typeDifferences(prefix, databaseColumn, drizzleColumn),
    ...nullabilityDifferences(prefix, databaseColumn, drizzleColumn),
  ]
}

function typeDifferences(prefix: string, databaseColumn: ColumnShape, drizzleColumn: PgColumn): string[] {
  const drizzleType = canonicalDrizzleType(drizzleColumn.getSQLType())

  if (drizzleType === undefined) {
    return [`${prefix} has the drizzle type ${drizzleColumn.getSQLType()}, which the table check does not know`]
  }

  if (drizzleType !== databaseColumn.type) {
    return [`${prefix} is ${databaseColumn.type} in the database but ${drizzleType} in drizzle`]
  }

  return []
}

function nullabilityDifferences(prefix: string, databaseColumn: ColumnShape, drizzleColumn: PgColumn): string[] {
  if (drizzleColumn.notNull === databaseColumn.isNotNull) return []

  const inDatabase = databaseColumn.isNotNull ? 'not null' : 'nullable'
  const inDrizzle = drizzleColumn.notNull ? 'not null' : 'nullable'

  return [`${prefix} is ${inDatabase} in the database but ${inDrizzle} in drizzle`]
}

// postgres does not track array dimensions, so integer[][] and integer[] are the same column
function canonicalDatabaseType(formattedType: string): string {
  return withoutDefaultTimePrecision(formattedType.replace(/(\[\])+$/, '[]'))
}

function withoutDefaultTimePrecision(type: string): string {
  return type.replace(defaultTimePrecisionPattern, 'timestamp')
}

const sqlTypePattern = /^([a-z ]+?)\s*(?:\(([\d,\s]+)\))?(\s+with(?:out)? time zone)?((?:\[\])*)$/

// drizzle spells types its own way (varchar(10), numeric(10, 2), timestamp (3) with time zone); this gives them the
// spelling format_type uses. undefined means a type the check does not know, which is reported rather than skipped
function canonicalDrizzleType(sqlType: string): string | undefined {
  const match = sqlTypePattern.exec(sqlType)

  if (!match) return undefined

  const [, baseType = '', parameterText = '', timeZoneText = '', arrayText = ''] = match
  const parameters = parameterText ? parameterText.split(',').map((part) => Number(part.trim())) : []
  const canonicalBase = canonicalBaseType(baseType, parameters, timeZoneText !== '')

  if (canonicalBase === undefined) return undefined

  return withoutDefaultTimePrecision(canonicalBase) + (arrayText ? '[]' : '')
}

const plainTypes = new Set([
  'text',
  'integer',
  'bigint',
  'smallint',
  'boolean',
  'uuid',
  'jsonb',
  'json',
  'date',
  'double precision',
])

function canonicalBaseType(baseType: string, parameters: number[], hasTimeZone: boolean): string | undefined {
  const [first, second] = parameters

  if (plainTypes.has(baseType)) {
    return parameters.length === 0 ? baseType : undefined
  }

  switch (baseType) {
    case 'numeric':
      return first === undefined ? 'numeric' : `numeric(${first},${second ?? 0})`
    case 'char':
      return `character(${first ?? 1})`
    case 'varchar':
      return first === undefined ? 'character varying' : `character varying(${first})`
    case 'timestamp': {
      const precision = first === undefined ? '' : `(${first})`

      return `timestamp${precision} ${hasTimeZone ? 'with' : 'without'} time zone`
    }

    default:
      return undefined
  }
}
