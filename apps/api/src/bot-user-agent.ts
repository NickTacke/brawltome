const crawlerPattern =
  /bot|crawl|spider|slurp|facebookexternalhit|meta-webindexer|bingpreview|yandex|baidu|duckduckbot|twitterbot|linkedinbot|embedly|quora|pinterest|redditbot|applebot|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider/i

// browsers driven by scripts, speed tests and uptime checks, which run the page's scripts like a visitor would
const automationPattern =
  /headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|phantomjs|puppeteer|playwright|selenium|webdriver|python-|aiohttp|curl\/|wget\/|go-http-client|okhttp|java\/|libwww|axios\/|node-fetch|undici|scrapy/i

/** Whether a user agent names a crawler, a link preview or an automated browser, whose page views are not demand. */
export function isBotUserAgent(userAgent: string): boolean {
  return crawlerPattern.test(userAgent) || automationPattern.test(userAgent)
}
