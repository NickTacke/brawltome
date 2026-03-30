import { invoke } from '@tauri-apps/api/core'
import { useCallback } from 'react'

export function useCursorForwarding() {
  const onMouseLeave = useCallback(() => {
    invoke('set_clickthrough', { ignore: true })
  }, [])

  return { onMouseLeave }
}
