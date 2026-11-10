import { randomBytes } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { eq, lt } from 'drizzle-orm'
import { dailySalts } from './tables'

const saltBytes = 32

/**
 * The salt of one utc day, the same for every process that asks. The first to ask creates it, and every call deletes
 * the salts of the days before, so a day's salt is gone once the next day has had a page view.
 */
export async function ensureDailySalt(database: Database, day: string): Promise<Uint8Array> {
  // insert before reading: when two processes ask together one insert wins, and both read the winner's row
  await insertSaltIfAbsent(database, day)

  // only older days: a process slightly ahead at midnight has already made the next day's salt, and deleting that
  // here would leave the two with different salts for the whole next day
  await database.db.delete(dailySalts).where(lt(dailySalts.day, day))

  const [stored] = await database.db.select({ salt: dailySalts.salt }).from(dailySalts).where(eq(dailySalts.day, day))

  if (!stored) throw new Error(`ensure daily salt for ${day}: the salt row is missing`)

  return Buffer.from(stored.salt, 'hex')
}

async function insertSaltIfAbsent(database: Database, day: string): Promise<void> {
  const candidateSalt = randomBytes(saltBytes).toString('hex')

  try {
    await database.db.insert(dailySalts).values({ day, salt: candidateSalt }).onConflictDoNothing()
  } catch (error) {
    throw insertFailure(day, error)
  }
}

// drizzle writes a failed query's parameters into its error message, and here one of them is the salt. the error is
// replaced by one that keeps only the driver's code, so whoever logs it can't log the salt
function insertFailure(day: string, error: unknown): Error {
  const failure = new Error(`ensure daily salt for ${day}: the insert failed`)
  const code = driverErrorCode(error)

  if (code === undefined) return failure

  return Object.assign(failure, { code })
}

// drizzle wraps the driver's error and keeps it as the cause
function driverErrorCode(error: unknown): string | undefined {
  const driverError = error instanceof Error ? error.cause : undefined
  const code = driverError instanceof Error && 'code' in driverError ? driverError.code : undefined

  return typeof code === 'string' ? code : undefined
}
