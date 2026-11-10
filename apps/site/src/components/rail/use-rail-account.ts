import { useEffect, useSyncExternalStore } from 'react'
import { getRailAccount } from '../../server/account'
import { type RailAccount, signedOutRail } from './rail-account'
import { createRailAccountStore } from './rail-account-store'

/** One account for the whole page: the rail, the mobile menu, the account page and the pin button share it. */
export const railAccount = createRailAccountStore(() => getRailAccount())

const serverSnapshot = () => signedOutRail

export function useRailAccount(): RailAccount {
  // only after hydration, so the html is the same for every visitor and no page waits on the account
  useEffect(() => {
    void railAccount.loadOnce()
  }, [])

  return useSyncExternalStore(railAccount.subscribe, railAccount.current, serverSnapshot)
}
