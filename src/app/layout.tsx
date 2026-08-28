import type { Metadata, Viewport } from 'next'
import { Toaster } from 'react-hot-toast'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/playfair-display'
import '@/styles/globals.css'
import PwaRegister from '@/components/PwaRegister'

export const metadata: Metadata = {
  title: { default: 'The Bread Chapter', template: '%s | The Bread Chapter' },
  description: 'The Bread Chapter — Smart Cafe Management',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'TBC POS',
  },
  icons: {
    icon: '/tbc-logo.ico',
    shortcut: '/tbc-logo-small.ico',
    apple: [
      { url: '/icon-152x152.png', sizes: '152x152', type: 'image/png' },
      { url: '/icon-180x180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#FF9500',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body bg-surface text-ink antialiased">
        <PwaRegister />
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: '#1A1A18',
              color: '#FAFAF8',
              borderRadius: '12px',
              fontSize: '14px',
            },
          }}
        />
      </body>
    </html>
  )
}
