// the codes the api puts in /account?error= when sign-in or steam verification fails
const messages = {
  state: 'Your sign-in expired or was interrupted. Please try again.',
  discord: "Discord couldn't finish signing you in. Please try again in a moment.",
  server: 'Something went wrong on our side. Please try again.',
  auth: 'Sign in first, then verify your Brawlhalla account.',
  steam: "Steam couldn't confirm your account. Please try again.",
  rate_limited: 'Too many tries. Please wait a minute and try again.',
} as const

export type AccountError = keyof typeof messages

function isAccountError(value: unknown): value is AccountError {
  return typeof value === 'string' && Object.hasOwn(messages, value)
}

export function parseAccountError(value: unknown): AccountError | undefined {
  return isAccountError(value) ? value : undefined
}

export function accountErrorMessage(error: AccountError | undefined): string | null {
  return error ? messages[error] : null
}
