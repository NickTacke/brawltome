import './global.css';
import { ThemeProvider } from '@/components/theme-provider';

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
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
