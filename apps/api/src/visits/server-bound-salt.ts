import { createHmac } from 'node:crypto'

type ServerBoundSaltOptions = {
  // a secret that only the api's environment holds and that stays the same across restarts
  serverSecret: string
  storedSaltFor: (day: string) => Promise<Uint8Array>
}

function bindSaltToServer(serverSecret: string, storedSalt: Uint8Array): Uint8Array {
  return createHmac('sha256', serverSecret).update('daily visitor salt\n').update(storedSalt).digest()
}

/**
 * The salt the visitor keys are made with: the day's stored salt mixed with a secret from the api's environment. A
 * database backup taken during the day carries the stored salt, and without the secret it can't recreate that day's
 * keys.
 */
export function createServerBoundSalts({ serverSecret, storedSaltFor }: ServerBoundSaltOptions) {
  return async function saltFor(day: string): Promise<Uint8Array> {
    const storedSalt = await storedSaltFor(day)

    return bindSaltToServer(serverSecret, storedSalt)
  }
}
