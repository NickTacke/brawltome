export const shellHrefs = ['/', '/stats', '/matches', '/learn', '/tournaments', '/feed'] as const
export type ShellHref = (typeof shellHrefs)[number]

export type ShellDestination = {
  label: string
  href: ShellHref
  status: 'live' | 'soon'
}

export function parseNavigationContract(input: unknown): ShellDestination[] {
  if (!Array.isArray(input)) throw new Error('navigation contract must be an array')

  const destinations = input.map((value, index): ShellDestination => {
    if (!value || typeof value !== 'object') throw new Error(`navigation destination ${index} must be an object`)
    const destination = value as Record<string, unknown>
    if (typeof destination.label !== 'string' || destination.label.length === 0) {
      throw new Error(`navigation destination ${index} requires a label`)
    }
    if (typeof destination.href !== 'string' || !shellHrefs.includes(destination.href as ShellHref)) {
      throw new Error(`navigation destination ${index} has an unknown href`)
    }
    if (destination.status !== 'live' && destination.status !== 'soon') {
      throw new Error(`navigation destination ${index} has an invalid status`)
    }
    return {
      label: destination.label,
      href: destination.href as ShellHref,
      status: destination.status,
    }
  })

  if (
    new Set(destinations.map(({ href }) => href)).size !== shellHrefs.length ||
    destinations.length !== shellHrefs.length
  ) {
    throw new Error('navigation contract must contain every shell destination exactly once')
  }
  return destinations
}
