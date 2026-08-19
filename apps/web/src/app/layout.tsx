import './globals.css'
import { MaintenancePage } from '@/components/MaintenancePage'
import { Providers } from '@/components/Providers'
import { SidebarLayout } from '@/components/sidebar/SidebarLayout'
import { SidebarProvider } from '@/components/sidebar/SidebarProvider'
import { resolveInitialAccountTheme } from '@/lib/theme'
import { getServerTrpc } from '@/lib/trpc-server'
import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'

export const metadata: Metadata = {
  title: {
    default: 'BrawlTome',
    template: '%s | BrawlTome',
  },
  description: 'Your ultimate source for Brawlhalla stats, rankings, and player tracking',
  keywords: ['Brawlhalla', 'stats', 'rankings', 'player tracker', 'clan', 'legends'],
  authors: [{ name: 'BrawlTome' }],
  metadataBase: new URL('https://brawltome.app'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://brawltome.app',
    siteName: 'BrawlTome',
    title: 'BrawlTome',
    description: 'Your ultimate source for Brawlhalla stats',
    images: [{ url: '/og-image.png', width: 500, height: 500, alt: 'BrawlTome' }],
  },
  twitter: {
    card: 'summary',
    title: 'BrawlTome',
    description: 'Your ultimate source for Brawlhalla stats',
    images: ['/og-image.png'],
  },
  icons: {
    icon: '/favicon.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'BrawlTome',
  },
}

export const viewport: Viewport = { themeColor: '#1e2530' }

const SESSION_COOKIE = 'brawltome_session'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const isMaintenanceMode = process.env.MAINTENANCE_MODE === 'true'
  const maintenanceEnd = process.env.MAINTENANCE_END
  const cookieStore = await cookies()
  const initialTheme = await resolveInitialAccountTheme(Boolean(cookieStore.get(SESSION_COOKIE)?.value), async () =>
    (await getServerTrpc()).account.preferences.query(),
  )

  return (
    <html lang="en" className="dark" data-theme={initialTheme} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <SidebarProvider>
            <div className="bg-background text-foreground min-h-screen">
              {isMaintenanceMode ? (
                <MaintenancePage maintenanceEnd={maintenanceEnd} />
              ) : (
                <SidebarLayout>{children}</SidebarLayout>
              )}
            </div>
          </SidebarProvider>
        </Providers>
      </body>
    </html>
  )
}
