import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Datenkrake — Scoreboard',
  description: 'Active topics across Slack, Jira, GitHub and Confluence.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <header className="border-border/60 bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
            <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-6 py-3">
              <span className="bg-foreground text-background inline-flex size-6 items-center justify-center rounded-md font-mono text-[11px] font-bold">
                DK
              </span>
              <span className="font-heading text-sm font-medium">Datenkrake</span>
              <span className="text-muted-foreground text-xs">/ scoreboard</span>
            </div>
          </header>
          <main className="flex-1">{children}</main>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
