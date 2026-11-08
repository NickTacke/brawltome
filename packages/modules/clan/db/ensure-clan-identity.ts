import { clans } from './tables'
import type { Transaction } from './transaction'

// every clan table references clans.clans, so the identity row comes first
export async function ensureClanIdentity(transaction: Transaction, clanId: number): Promise<void> {
  await transaction.insert(clans).values({ clanId }).onConflictDoNothing()
}
