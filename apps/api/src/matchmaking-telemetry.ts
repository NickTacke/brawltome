export type R2Put = (key: string, bytes: Uint8Array, options?: { contentType?: string }) => Promise<void>

export type R2SourceCallObserver = <T>(domain: 'r2', work: () => Promise<T>) => Promise<T>

export function createObservedR2Put(r2: { put: R2Put }, observer?: R2SourceCallObserver): R2Put {
  const observe = observer ?? ((_domain, work) => work())
  return (key, bytes, options) => observe('r2', () => r2.put(key, bytes, options))
}
