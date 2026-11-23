import { describe, expect, test } from 'bun:test'
import { isRedirect } from '@tanstack/react-router'

type RouteOptions = {
  validateSearch: (search: Record<string, unknown>) => { page?: number }
  beforeLoad: (context: { search: { page?: number } }) => void
}

async function redirectFor(search: Record<string, unknown>) {
  const { Route } = await import('../src/routes/guilds')
  const options = Route.options as unknown as RouteOptions

  try {
    options.beforeLoad({ search: options.validateSearch(search) })
  } catch (thrown) {
    return thrown
  }

  return null
}

describe('old guilds address', () => {
  test('sends a visitor on to the guild leaderboard for good', async () => {
    const thrown = await redirectFor({})

    expect(isRedirect(thrown)).toBe(true)

    expect((thrown as { options: { to: string; statusCode: number } }).options).toMatchObject({
      to: '/leaderboard/guilds',
      statusCode: 301,
    })
  })

  test('keeps the page it was on', async () => {
    const thrown = await redirectFor({ page: 7 })

    expect((thrown as { options: { search: unknown } }).options.search).toEqual({ page: 7 })
  })
})
