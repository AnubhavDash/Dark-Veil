import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import { Backdrop } from '@/components/backdrop'
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

/**
 * Absolute base for OG/Twitter image URLs. Vercel exposes the production host for us.
 * Env vars that exist but are blank are treated as unset — `??` would let `''` through and
 * `new URL('')` throws at module evaluation, which takes the whole build down. A bare host
 * with no scheme is accepted too, since that is the easy mistake to make here.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return /^https?:\/\//.test(explicit) ? explicit : `https://${explicit}`

  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (vercelHost) return `https://${vercelHost}`

  return 'http://localhost:3000'
}

const siteUrl = resolveSiteUrl()

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Dark Veil',
    template: '%s',
  },
  description:
    'Detect a face in the browser, find real public matches on the live web with Gemini or Google Lens, then anchor and re-verify the result on the Ethereum Sepolia blockchain.',
  applicationName: 'Dark Veil',
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
    title: 'Dark Veil — from a face to an on-chain proof',
    description:
      'In-browser face detection, live web reverse search, and a keccak256 digest anchored in Ethereum Sepolia calldata.',
    siteName: 'Dark Veil',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dark Veil — from a face to an on-chain proof',
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
        <Backdrop />
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
