import { describe, expect, test } from 'bun:test'
import { Route } from '../src/routes/account'

type ValidateSearch = (search: Record<string, unknown>) => { error?: string }
type Headers = () => Record<string, string>
type Head = () => { meta: Record<string, string>[] }

describe('account route', () => {
  const validateSearch = Route.options.validateSearch as unknown as ValidateSearch

  test('keeps an error code the api sends', () => {
    expect(validateSearch({ error: 'steam' })).toEqual({ error: 'steam' })
  })

  test('drops anything else in the error', () => {
    expect(validateSearch({ error: '<b>hi</b>' }).error).toBeUndefined()
  })

  test('keeps the page out of shared caches', () => {
    expect((Route.options.headers as unknown as Headers)()).toEqual({ 'cache-control': 'private, no-store' })
  })

  test('keeps the page out of search engines', () => {
    expect((Route.options.head as unknown as Head)().meta).toContainEqual({ name: 'robots', content: 'noindex' })
  })
})
