import Link from 'next/link';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';
import { ActivityRail } from '@/components/scoreboard/activity-rail';
import { LanguagePicker } from '@/components/scoreboard/language-picker';
import { ThemeProvider } from '@/components/theme-provider';
import { getPreferredLanguage } from '@/lib/language-server';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'DataClaw — Dashboard',
  description: 'Priority dashboard across Slack, Jira, GitHub and Confluence.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const language = await getPreferredLanguage('en');

  return (
    <html
      lang={language}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          forcedTheme="light"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <header className="border-border/60 bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
            <div className="mx-auto flex w-full max-w-[90rem] items-center gap-3 px-6 py-3">
              <Link
                href="/"
                className="hover:text-foreground focus-visible:outline-ring/60 inline-flex items-center gap-3 rounded-md text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span className="bg-foreground text-background inline-flex size-6 items-center justify-center rounded-md font-mono text-[11px] font-bold">
                  DC
                </span>
                <span className="font-heading text-sm font-medium">DataClaw</span>
              </Link>
              <span className="text-muted-foreground text-xs">/ dashboard</span>
              <div className="ml-auto">
                <LanguagePicker language={language} />
              </div>
            </div>
          </header>
          <main className="flex-1">
            <div className="grid w-full [grid-template-areas:'rail''content'] xl:mx-auto xl:max-w-[1616px] xl:grid-cols-[17rem_minmax(0,1fr)_17rem] xl:gap-6 xl:px-6 xl:[grid-template-areas:'phantom_content_rail']">
              <div className="min-w-0 [grid-area:content]">{children}</div>
              <ActivityRail />
            </div>
          </main>
          <Toaster theme="light" />
        </ThemeProvider>
      </body>
    </html>
  );
}
