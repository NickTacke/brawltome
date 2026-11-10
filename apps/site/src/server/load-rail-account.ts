import '@tanstack/react-start/server-only'
import { MAX_PINNED_PLAYERS } from '@brawltome/contracts'
import { type RailAccount, signedOutRail, toRailAccount } from '../components/rail/rail-account'
import { type AccountSession, readSignedInAccount } from './load-account'
import { failureText } from './optional-read'

/** The visitor's avatar and pinned players for the rail. Without a session cookie it never asks the api. */
export async function loadRailAccount(session: AccountSession): Promise<RailAccount> {
  try {
    const signedIn = await readSignedInAccount(session)

    return signedIn ? toRailAccount(signedIn, MAX_PINNED_PLAYERS) : signedOutRail
  } catch (error) {
    console.error(failureText(error))

    // thrown messages reach the browser, so the detail only goes to the server log
    throw new Error('load rail account: the account could not be read')
  }
}
