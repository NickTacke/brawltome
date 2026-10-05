export const MAX_BODY_BYTES = 64_000

/** Reads a request body as text, giving up (null) as soon as it exceeds the cap instead of buffering it all. */
export async function readBoundedText(request: Request, maxBytes = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}
