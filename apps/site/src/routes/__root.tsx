import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AppRail } from '../components/AppRail'
import { MobileMenu } from '../components/MobileMenu'
import { SiteFooter } from '../components/SiteFooter'
import appStyles from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#1e2530' },
      { title: 'BrawlTome' },
    ],
    links: [
      { rel: 'stylesheet', href: appStyles },
      { rel: 'icon', href: '/favicon.png' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <AppRail />
      <MobileMenu />
      {/* clip, not hidden, so sticky columns keep working: full-width pages use 100vw, which counts the scrollbar */}
      <div className="flex min-h-dvh flex-col overflow-x-clip md:pl-[57px]">
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 pt-7 pb-10 md:pt-10">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
