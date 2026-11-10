import { describe, expect, test } from 'bun:test'
import { siteVisitInputSchema, siteVisitResponseSchema } from '../src'

const visit = { visitId: 'a'.repeat(32), path: '/player/7', viewportWidth: 1280 }

describe('site visit', () => {
  test('takes the visit id, the path and the viewport width', () => {
    expect(siteVisitInputSchema.parse(visit)).toEqual(visit)

    expect(siteVisitInputSchema.parse({ ...visit, referrerDomain: 'reddit.com' })).toMatchObject({
      referrerDomain: 'reddit.com',
    })
  })

  test('refuses anything that could carry more than a label', () => {
    expect(siteVisitInputSchema.safeParse({ ...visit, visitId: 'not-hex' }).success).toBe(false)
    expect(siteVisitInputSchema.safeParse({ ...visit, path: 'https://evil.test/' }).success).toBe(false)
    expect(siteVisitInputSchema.safeParse({ ...visit, path: `/${'a'.repeat(300)}` }).success).toBe(false)
    expect(siteVisitInputSchema.safeParse({ ...visit, referrerDomain: 'https://reddit.com/r/x' }).success).toBe(false)
    expect(siteVisitInputSchema.safeParse({ ...visit, ip: '203.0.113.9' }).success).toBe(false)
  })

  test('answers whether the view was counted, and nothing else', () => {
    expect(siteVisitResponseSchema.parse({ recorded: false })).toEqual({ recorded: false })
    expect(siteVisitResponseSchema.safeParse({ recorded: true, key: 'abc' }).success).toBe(false)
  })
})
