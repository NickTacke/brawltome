// a payload is untrusted json until its job has parsed it, whether it just arrived or has been stored for a while

export function readPayloadObject(value: unknown, jobName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${jobName} payload must be an object`)
  }

  return value as Record<string, unknown>
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

export function isPositive32BitInteger(value: unknown): value is number {
  return isPositiveInteger(value) && value <= 2_147_483_647
}

export function hasOnlyFields(payload: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(payload).length === fields.length && fields.every((field) => Object.hasOwn(payload, field))
}

// duplicates pass on purpose: rows written before these checks moved here were only asked for containment
export function isSectionList(value: unknown, sections: readonly string[]): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > sections.length) return false

  return value.every((section) => sections.includes(section))
}
