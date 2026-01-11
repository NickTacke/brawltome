import './global.css';
import { ThemeProvider } from '@/components/theme-provider';
import { ComingSoon } from '@/components/ComingSoon';
import { ModeToggle } from '@/components/mode-toggle';
import type { Metadata } from 'next';

const IS_MAINTENANCE = false;

export const metadata: Metadata = {
  title: {
    default: 'BrawlTome',
    template: '%s | BrawlTome',
  },
  description:
    'Your ultimate source for Brawlhalla stats, rankings, and player tracking',
  keywords: [
    'Brawlhalla',
    'stats',
    'rankings',
    'player tracker',
    'clan',
    'legends',
  ],
  authors: [{ name: 'BrawlTome' }],
  metadataBase: new URL('https://brawltome.app'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://brawltome.app',
    siteName: 'BrawlTome',
    title: 'BrawlTome',
    description: 'Your ultimate source for Brawlhalla stats',
    images: [
      { url: '/og-image.png', width: 1200, height: 630, alt: 'BrawlTome' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="bg-background text-foreground min-h-screen">
            {IS_MAINTENANCE ? (
              <main className="min-h-screen flex flex-col items-center justify-center p-4 relative">
                <div className="absolute top-4 right-4 z-100">
                  <ModeToggle />
                </div>
                <ComingSoon />
              </main>
            ) : (
              children
            )}
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
