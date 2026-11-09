import { useEffect } from 'react'

// the page behind dims through a css rule on this attribute, so no section needs to know about search
export function usePageDim(isDimmed: boolean) {
  useEffect(() => {
    document.body.dataset.searching = String(isDimmed)

    return () => {
      delete document.body.dataset.searching
    }
  }, [isDimmed])
}
