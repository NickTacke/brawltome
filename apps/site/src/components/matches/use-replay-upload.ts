import { MAX_REPLAYS_PER_UPLOAD } from '@brawltome/contracts'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { uploadReplays } from '../../server/replays'

export type ReplayUpload = { isUploading: boolean; message: string | null; upload: (files: File[]) => Promise<void> }

/** Sends dropped or picked .replay files in batches the api takes, then reloads the page to show them. */
export function useReplayUpload(): ReplayUpload {
  const router = useRouter()
  const [isUploading, setIsUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function upload(files: File[]) {
    const replays = files.filter((file) => file.name.endsWith('.replay'))

    if (replays.length === 0) {
      setMessage('Only .replay files can be uploaded.')

      return
    }

    setIsUploading(true)
    setMessage(null)

    for (let start = 0; start < replays.length; start += MAX_REPLAYS_PER_UPLOAD) {
      const form = new FormData()

      for (const file of replays.slice(start, start + MAX_REPLAYS_PER_UPLOAD)) form.append('files', file, file.name)

      const answer = await uploadReplays({ data: form }).catch(() => ({ kind: 'failed' }) as const)

      if (answer.kind !== 'uploaded') {
        setMessage(
          answer.kind === 'notVerified' ? 'Link your account with Steam first.' : 'The upload didn’t go through.',
        )

        break
      }
    }

    setIsUploading(false)
    await router.invalidate()
  }

  return { isUploading, message, upload }
}
