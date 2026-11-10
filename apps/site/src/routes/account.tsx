import { createFileRoute } from '@tanstack/react-router'
import { type AccountError, accountErrorMessage, parseAccountError } from '../components/account/account-errors'
import { SignedInPage } from '../components/account/SignedInPage'
import { SignedOutPanel } from '../components/account/SignedOutPanel'
import { getAccount } from '../server/account'

export const Route = createFileRoute('/account')({
  // the api sends a failed sign-in or steam check back here with ?error=<code>
  validateSearch: (search: Record<string, unknown>): { error?: AccountError } => ({
    error: parseAccountError(search.error),
  }),
  loader: () => getAccount(),
  head: () => ({ meta: [{ title: 'Account | BrawlTome' }, { name: 'robots', content: 'noindex' }] }),
  // one visitor's account, so no cache between the browser and the site may keep the page
  headers: () => ({ 'cache-control': 'private, no-store' }),
  errorComponent: AccountLoadError,
  component: AccountRoute,
})

// a fixed message, the error itself is for the server log
function AccountLoadError() {
  return (
    <div className="py-16">
      <h1 className="text-heading font-semibold">Your account couldn't be loaded</h1>
      <p className="mt-2 text-soft">Something went wrong on our side. It's usually back in a moment.</p>
      <a href="/account" className="mt-4 inline-block text-primary underline underline-offset-4">
        Try again
      </a>
    </div>
  )
}

function AccountRoute() {
  const page = Route.useLoaderData()
  const { error } = Route.useSearch()
  const errorMessage = accountErrorMessage(error)

  if (page.kind === 'signedOut') return <SignedOutPanel signInUrl={page.signInUrl} errorMessage={errorMessage} />

  return <SignedInPage page={page} errorMessage={errorMessage} />
}
