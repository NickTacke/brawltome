import { socialLinks } from '../social-links'

const discordIcon = socialLinks.find((link) => link.label === 'Discord')?.svg

type SignedOutPanelProps = { signInUrl: string; errorMessage: string | null }

export function SignedOutPanel({ signInUrl, errorMessage }: SignedOutPanelProps) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <img src="/images/logo.png" alt="" width={144} height={144} className="size-36" />
      <h1 className="mt-5 text-3xl font-black tracking-tight text-strong">Sign in to BrawlTome</h1>
      <p className="mt-2 max-w-sm text-soft">Pin the players you follow and verify your own Brawlhalla account.</p>
      {/* sign-in runs on the api, which sets the session cookie and sends the browser back here */}
      <a
        href={signInUrl}
        className="mt-7 inline-flex h-11 items-center gap-2.5 rounded-control bg-[#5865F2] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#4f5bdc]"
      >
        {discordIcon}
        Continue with Discord
      </a>
      {errorMessage && (
        <p role="alert" className="mt-4 text-sm font-medium text-red-400">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
