import type { TransactionSql } from 'postgres'

export async function v2AuthCutoverIsFinalized(transaction: TransactionSql): Promise<boolean> {
  const [state] = await transaction.unsafe<{ finalized: boolean }[]>(
    'SELECT EXISTS (SELECT 1 FROM accounts.v2_auth_cutover WHERE singleton) AS finalized',
  )
  return state.finalized
}
