import type { SiteEventInputContract } from '@brawltome/contracts'
import { isNotFound } from '@tanstack/react-router'

type ClientErrorKind = Extract<SiteEventInputContract, { name: 'error.client' }>['kind']

type ClientErrorReporterOptions = {
  // null for a visitor we may not count
  tabVisitId: () => string | null
  currentPath: () => string
  countSiteEvent: (event: SiteEventInputContract) => Promise<unknown>
}

export type ClientErrorReporter = ReturnType<typeof createClientErrorReporter>

// the api refuses anything longer
const longestMessageLength = 1_000
// a page that throws in a loop would otherwise use up the visitor's budget for searches and loading speed
const mostReportsPerTab = 10

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown)
}

function send(options: ClientErrorReporterOptions, kind: ClientErrorKind, message: string): void {
  const visitId = options.tabVisitId()

  if (visitId === null) return

  const event: SiteEventInputContract = {
    visitId,
    path: options.currentPath(),
    name: 'error.client',
    kind,
    message: message.slice(0, longestMessageLength),
  }

  options.countSiteEvent(event).catch(() => undefined)
}

/**
 * Reports the errors of a tab, without ever failing the page they happened on. A report that fails is dropped: an
 * error about it would be reported in turn.
 */
export function createClientErrorReporter(options: ClientErrorReporterOptions) {
  let reportCount = 0

  // counted before it is sent, so a report that keeps failing runs out as well
  function report(kind: ClientErrorKind, readMessage: () => string): void {
    if (reportCount >= mostReportsPerTab) return

    reportCount += 1

    try {
      send(options, kind, readMessage())
    } catch {
      // counting is never worth an error on the page
    }
  }

  // an error boundary caught it and shows its own message. a page that isn't there is an answer, not an error
  function render(thrown: unknown): void {
    if (isNotFound(thrown)) return

    report('render', () => messageOf(thrown))
  }

  return {
    render,
    // the window's error event: a script error nothing caught
    unhandled: (event: { message: unknown }) => report('unhandled', () => String(event.message)),
    // the window's unhandledrejection event
    rejection: (event: { reason: unknown }) => report('rejection', () => String(event.reason)),
  }
}
