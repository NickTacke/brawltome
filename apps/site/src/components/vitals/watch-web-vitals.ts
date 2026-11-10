import type { WebVitalsReporter } from './web-vitals-reporter'

type Watch = (report: WebVitalsReporter) => void

// the part of the web-vitals package that is used
type WebVitalsLibrary = { onCLS: Watch; onINP: Watch; onLCP: Watch; onTTFB: Watch }

/**
 * Loads the library and has it hand the tab's web vitals to the reporter. Nothing is loaded for a visitor we may not
 * count, and a library that fails to load is not worth an error on the page.
 */
export async function watchWebVitals(
  report: WebVitalsReporter | null,
  loadLibrary: () => Promise<WebVitalsLibrary>,
): Promise<void> {
  if (!report) return

  try {
    const { onCLS, onINP, onLCP, onTTFB } = await loadLibrary()

    onCLS(report)
    onINP(report)
    onLCP(report)
    onTTFB(report)
  } catch {
    // without the library the page works the same, only unmeasured
  }
}
