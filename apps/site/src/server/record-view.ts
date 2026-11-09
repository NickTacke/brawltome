import '@tanstack/react-start/server-only'
import { playerViewResponseSchema } from '@brawltome/contracts'
import { postApi } from './api'
import { failureText, optionalRead } from './optional-read'
import type { Visitor } from './visitor-headers'

/** Counts a visitor's view of a player page, which the api uses as refresh demand. Best effort, never throws. */
export async function recordView(playerId: number, visitor: Visitor): Promise<void> {
  const description = `count a view of player ${playerId}`

  try {
    await postApi(`/players/${playerId}/views`, {}, playerViewResponseSchema, description, {
      ...optionalRead,
      headers: visitor.headers,
    })
  } catch (error) {
    console.error(failureText(error))
  }
}
