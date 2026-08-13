import type { Telemetry } from '@brawltome/telemetry'

type InteractionKind = 'command' | 'select' | 'button'
type CommandName = 'player' | 'clan' | 'status' | 'component' | 'unknown'

export function createInteractionRuntime(telemetry: Telemetry) {
  const active = new Set<Promise<void>>()
  let accepting = true

  function stopAccepting(): void {
    accepting = false
  }

  function run(input: { id: string; kind: InteractionKind; command: CommandName }, work: () => Promise<void>): boolean {
    if (!accepting) {
      telemetry.metrics.add('discord_interactions_total', 1, {
        interaction_kind: input.kind,
        command: input.command,
        outcome: 'rejected',
      })
      telemetry.logger.warn('discord.interaction.rejected', {
        interactionKind: input.kind,
        command: input.command,
      })
      return false
    }
    const context = telemetry.contextFromHeaders({ 'x-request-id': input.id }, { acceptIncoming: true })
    const execution = telemetry.run(context, async () => {
      telemetry.logger.info('discord.interaction.started', {
        interactionId: input.id,
        interactionKind: input.kind,
        command: input.command,
      })
      try {
        await work()
        telemetry.metrics.add('discord_interactions_total', 1, {
          interaction_kind: input.kind,
          command: input.command,
          outcome: 'succeeded',
        })
      } catch (error) {
        telemetry.metrics.add('discord_interactions_total', 1, {
          interaction_kind: input.kind,
          command: input.command,
          outcome: 'failed',
        })
        telemetry.logger.error('discord.interaction.failed', error, {
          interactionId: input.id,
          interactionKind: input.kind,
          command: input.command,
        })
      }
    })
    active.add(execution)
    void execution.finally(() => active.delete(execution))
    return true
  }

  async function drain(deadlineMs: number): Promise<boolean> {
    stopAccepting()
    if (active.size === 0) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(0, deadlineMs))
    })
    const drained = Promise.allSettled([...active]).then(() => true as const)
    const result = await Promise.race([drained, timedOut])
    if (timer) clearTimeout(timer)
    return result
  }

  return {
    run,
    stopAccepting,
    drain,
    get accepting() {
      return accepting
    },
    get activeCount() {
      return active.size
    },
  }
}
