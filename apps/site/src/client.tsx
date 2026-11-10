import { StartClient } from '@tanstack/react-start/client'
import { StrictMode, startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { reportCaughtError, watchTabErrors } from './components/errors/tab-client-errors'

// the framework's own client entry, with the two hooks that tell us about errors in the browser. neither changes
// what a visitor sees: the error boundaries render as before
watchTabErrors()

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
    { onCaughtError: reportCaughtError },
  )
})
