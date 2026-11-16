import { desktopVersionHeader } from '@brawltome/contracts'
import type { MiddlewareHandler } from 'hono'
import {
  type DesktopVersion,
  formatDesktopVersion,
  isOlderDesktopVersion,
  parseDesktopVersion,
} from './desktop-version'

export type DesktopVariables = { desktopVersion: string }

// no Upgrade header on the 426: it is hop-by-hop and HTTP/2 proxies drop it
export function requireDesktopVersion(minimum: DesktopVersion): MiddlewareHandler<{ Variables: DesktopVariables }> {
  return async (context, next) => {
    const headerText = context.req.header(desktopVersionHeader)
    const version = parseDesktopVersion(headerText)

    if (!headerText || !version) return context.json({ error: 'invalid_desktop_version' }, 400)

    if (isOlderDesktopVersion(version, minimum)) {
      return context.json({ minimumVersion: formatDesktopVersion(minimum) }, 426)
    }

    context.set('desktopVersion', headerText)

    await next()
  }
}
