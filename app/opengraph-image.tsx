import { ImageResponse } from 'next/og'

export const alt = 'Dark Veil — detect a face, find it on the live web, anchor the proof on Ethereum Sepolia'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Satori only understands hex/rgb, so the oklch palette is hand-converted here.
const BG = '#080b14'
const CYAN = '#4fd8f5'
const MAGENTA = '#f25bc0'
const DIM = '#8b93a8'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: BG,
          backgroundImage: `radial-gradient(900px 500px at 15% 0%, rgba(79,216,245,0.18), transparent 70%), radial-gradient(700px 450px at 100% 100%, rgba(242,91,192,0.16), transparent 70%)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: 22,
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
            color: CYAN,
          }}
        >
          <div style={{ display: 'flex', width: '56px', height: '2px', background: CYAN }} />
          face → web → chain
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: '28px',
            fontSize: 148,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            color: '#f2f5fb',
          }}
        >
          DARK VEIL
        </div>

        <div style={{ display: 'flex', marginTop: '20px', fontSize: 34, lineHeight: 1.35, color: DIM, maxWidth: '900px' }}>
          Detect a face in the browser, find real matches on the live web, then anchor and
          re-verify the result on Ethereum Sepolia.
        </div>

        <div style={{ display: 'flex', marginTop: '52px', gap: '14px' }}>
          {['face-api · 128-d', 'gemini + lens', 'keccak256 → sepolia'].map((chip) => (
            <div
              key={chip}
              style={{
                display: 'flex',
                padding: '10px 20px',
                borderRadius: '999px',
                border: `1px solid rgba(79,216,245,0.35)`,
                background: 'rgba(79,216,245,0.08)',
                fontSize: 24,
                color: CYAN,
              }}
            >
              {chip}
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '6px',
            background: `linear-gradient(90deg, ${CYAN}, ${MAGENTA})`,
          }}
        />
      </div>
    ),
    size,
  )
}
