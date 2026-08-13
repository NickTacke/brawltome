type RenderedOpponent = {
  refreshState: string
}

export function renderAcknowledgement(
  sampleId: string | null,
  opponents: readonly RenderedOpponent[],
): { sampleId: string; apiFailurePresented: boolean } | null {
  if (!sampleId || opponents.length === 0) return null
  return {
    sampleId,
    apiFailurePresented: opponents.some((opponent) => opponent.refreshState === 'apiFailure'),
  }
}
