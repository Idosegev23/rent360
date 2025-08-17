import '../styles/globals.css'
import Providers from './providers'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Rent360',
  description: 'ניהול נכסי שכירות ולידים',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen bg-brand-bg text-brand-ink">
        <Providers>
          <div className="container py-4">
            {children}
          </div>
          <div className="h-16" />
        </Providers>
      </body>
    </html>
  )
}
