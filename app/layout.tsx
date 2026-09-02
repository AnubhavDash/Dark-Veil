import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

/** Absolute base for OG/Twitter image URLs. Vercel sets the production host for us. */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'FACENET // Face → Web → Chain',
    template: '%s',
  },
  description:
    'Detect a face in the browser, find real public matches on the live web with Gemini or Google Lens, then anchor and re-verify the result on the Ethereum Sepolia blockchain.',
  applicationName: 'FACENET',
  keywords: [
    'face recognition',
    'face-api',
    'reverse image search',
    'Gemini',
    'Google Lens',
    'Ethereum',
    'Sepolia',
    'keccak256',
    'proof of authenticity',
  ],
  openGraph: {
    title: 'FACENET // Face → Web → Chain',
    description:
      'In-browser face detection, live web reverse search, and a keccak256 digest anchored in Ethereum Sepolia calldata.',
    siteName: 'FACENET',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FACENET // Face → Web → Chain',
    description:
      'In-browser face detection, live web reverse search, and a keccak256 digest anchored in Ethereum Sepolia calldata.',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0a0a12',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`dark ${display.variable} ${mono.variable}`}>
      <body className="antialiased font-sans">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
