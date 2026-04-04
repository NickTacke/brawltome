import './globals.css'
import { MaintenancePage } from '@/components/MaintenancePage'
import { SidebarLayout } from '@/components/sidebar/SidebarLayout'
import { SidebarProvider } from '@/components/sidebar/SidebarProvider'
import { ThemeProvider } from '@/components/theme-provider'
import type { Metadata } from 'next'

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#1e2530' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isMaintenanceMode = process.env.MAINTENANCE_MODE === 'true'
  const maintenanceEnd = process.env.MAINTENANCE_END

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <SidebarProvider>
            <div className="bg-background text-foreground min-h-screen">
              {isMaintenanceMode ? (
                <MaintenancePage maintenanceEnd={maintenanceEnd} />
              ) : (
                <SidebarLayout>{children}</SidebarLayout>
              )}
            </div>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
