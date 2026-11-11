import '../styles/globals.css'
import Providers from './providers'
import type { Metadata, Viewport } from 'next'

// Fonts load straight from Google Fonts. next/font (Next 14) can no longer parse Google's font URLs
// (they dropped the file extension), which fails every production build. The CSS variables below
// keep the names the stylesheet and Tailwind config already use.
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&family=Frank+Ruhl+Libre:wght@300;400;500;700;900&family=JetBrains+Mono:wght@400;500;600&display=swap'

const fontVars = {
  '--font-ui': "'Assistant'",
  '--font-display': "'Frank Ruhl Libre'",
  '--font-mono': "'JetBrains Mono'",
} as React.CSSProperties

export const metadata: Metadata = {
  title: 'rent360 — real estate ops',
  description: 'ניהול נכסי שכירות, שוכרים והתאמות',
}

// viewport-fit=cover enables env(safe-area-inset-*) so fixed UI (bottom tabs) clears the
// iPhone notch/home indicator. Mobile-first zoom defaults kept.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" style={fontVars}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_HREF} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
