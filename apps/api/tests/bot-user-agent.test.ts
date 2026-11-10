import { describe, expect, test } from 'bun:test'
import { isBotUserAgent } from '../src/bot-user-agent'

describe('isBotUserAgent', () => {
  test.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 Chrome-Lighthouse',
    'curl/8.7.1',
    'python-requests/2.32.3',
  ])('names %s a bot', (userAgent) => {
    expect(isBotUserAgent(userAgent)).toBe(true)
  })

  test.each([
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  ])('lets a browser through: %s', (userAgent) => {
    expect(isBotUserAgent(userAgent)).toBe(false)
  })
})
