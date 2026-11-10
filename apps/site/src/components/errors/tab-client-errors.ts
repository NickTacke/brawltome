import { countSiteEvent } from '../../server/visits'
import { tabVisitIdOrNull } from '../visits/tab-visit-id'
import { createClientErrorReporter } from './client-error-reporter'

// one per tab, so every kind of error counts towards the same limit. it touches nothing until there is an error
const reporter = createClientErrorReporter({
  tabVisitId: tabVisitIdOrNull,
  currentPath: () => window.location.pathname,
  countSiteEvent: (event) => countSiteEvent({ data: event }),
})

/** For react's root: an error one of the page's error boundaries caught. The boundary shows what it showed before. */
export function reportCaughtError(error: unknown): void {
  // what react does itself when it is given no handler
  console.error(error)

  reporter.render(error)
}

/** Reports the tab's script errors and unhandled rejections from now on. Never throws, the page starts after it. */
export function watchTabErrors(): void {
  try {
    window.addEventListener('error', reporter.unhandled)
    window.addEventListener('unhandledrejection', reporter.rejection)
  } catch {
    // a tab that isn't watched works the same
  }
}
