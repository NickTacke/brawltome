import { createHmac } from 'node:crypto'

/**
 * The salt the visitor keys are made with: the day's stored salt mixed with a secret that only the api's environment
 * holds. A database backup taken during the day carries the stored salt, and without the secret it can't recreate
 * that day's keys.
 */
export function bindSaltToServer(serverSecret: string, storedSalt: Uint8Array): Uint8Array {
  return createHmac('sha256', serverSecret).update('daily visitor salt\n').update(storedSalt).digest()
}
