const botPattern =
  /bot|crawl|spider|slurp|facebookexternalhit|meta-webindexer|bingpreview|yandex|baidu|duckduckbot|twitterbot|linkedinbot|embedly|quora|pinterest|redditbot|applebot|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider/i

/** Whether a user agent names a crawler or link preview, whose page views are not demand. */
export function isBotUserAgent(userAgent: string): boolean {
  return botPattern.test(userAgent)
}
