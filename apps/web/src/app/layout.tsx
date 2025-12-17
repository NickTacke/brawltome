import './global.css';
import { ThemeProvider } from '@/components/theme-provider';
import { ComingSoon } from '@/components/ComingSoon';
import { ModeToggle } from '@/components/mode-toggle';

const IS_MAINTENANCE = false;

export const metadata = {
  title: 'BrawlTome',
  description: 'brawltome.app - Your ultimate source for Brawlhalla stats',
  icons: {
    icon: '/favicon.png',
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
