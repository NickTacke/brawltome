import type { Context } from './trpc/context'

/** What recording a profile view needs from the caller, so tRPC and oRPC can both record one. */
export type ProfileViewContext = Pick<Context, 'telemetry' | 'requestAdmission' | 'profileViews' | 'clientIp' | 'isBot'>

function recordTelemetry(record: () => void): void {
  try {
    record()
  } catch {
    return
  }
}

// Counts a profile view for background refresh demand. Bots are not demand, and each visitor has a view budget (no
// challenge: over it the view is simply not counted); failures never reach the visitor.
export async function recordProfileView(ctx: ProfileViewContext, brawlhallaId: number): Promise<{ recorded: boolean }> {
  if (ctx.isBot || !ctx.profileViews) return { recorded: false }

  try {
    const admission = await ctx.requestAdmission.admitActorOnce({ kind: 'profile-view', ip: ctx.clientIp })

    if (admission.outcome !== 'admitted') return { recorded: false }

    await ctx.profileViews.recordView(brawlhallaId)

    return { recorded: true }
  } catch (error) {
    recordTelemetry(() => ctx.telemetry.logger.error('player.view.record_failed', error))

    return { recorded: false }
  }
}
