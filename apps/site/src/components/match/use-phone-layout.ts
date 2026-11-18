import { useSyncExternalStore } from 'react'

// the same as the phone variant in styles.css
export const phoneQuery = '(width < 40rem) and (orientation: portrait)'

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(phoneQuery)

  query.addEventListener('change', onChange)

  return () => query.removeEventListener('change', onChange)
}

const isPhoneNow = () => window.matchMedia(phoneQuery).matches
// the server can't tell, and lays the page out as on a desktop
const isPhoneOnServer = () => false

/** True while the page is laid out for a phone held upright, for what the phone variant can't decide in css alone. */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, isPhoneNow, isPhoneOnServer)
}
