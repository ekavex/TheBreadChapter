'use client'
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { base64ToBytes, type PreviewLine, type RenderedTicket } from '@/lib/printer/template/render'

// Draws a rendered ticket at printer scale: 1 printer dot = 1 CSS pixel, so a
// 58mm ticket is 384px wide. Monospace glyphs are ~0.6em wide, which sets the
// font size that fits exactly `columns` characters per line.
const GLYPH_WIDTH_EM = 0.6

const ORIGIN = { left: 'left top', center: 'center top', right: 'right top' } as const

function LogoImage({ line }: { line: Extract<PreviewLine, { kind: 'image' }> }) {
  const src = useMemo(() => {
    if (typeof document === 'undefined') return ''
    const canvas = document.createElement('canvas')
    canvas.width = line.width
    canvas.height = line.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    const img = ctx.createImageData(line.width, line.height)
    const bits = base64ToBytes(line.data)
    const rowBytes = Math.ceil(line.width / 8)
    for (let y = 0; y < line.height; y++) {
      for (let x = 0; x < line.width; x++) {
        const black = (bits[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1
        const i = (y * line.width + x) * 4
        const v = black ? 20 : 255
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return canvas.toDataURL()
  }, [line.width, line.height, line.data])

  return (
    <div style={{ textAlign: line.align }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} width={line.width} height={line.height} alt="Logo" className="inline-block [image-rendering:pixelated]" />}
    </div>
  )
}

function QrImage({ line }: { line: Extract<PreviewLine, { kind: 'qr' }> }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(line.data, { errorCorrectionLevel: 'L', margin: 0, scale: line.moduleSize })
      .then((url) => { if (!cancelled) setSrc(url) })
      .catch(() => { if (!cancelled) setSrc('') })
    return () => { cancelled = true }
  }, [line.data, line.moduleSize])

  return (
    <div style={{ textAlign: line.align }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="UPI QR code" className="inline-block [image-rendering:pixelated]" />}
    </div>
  )
}

export default function TicketPreview({ ticket }: { ticket: RenderedTicket }) {
  const charWidth = ticket.paperDots / ticket.columns
  const fontSize = charWidth / GLYPH_WIDTH_EM
  const lineHeight = Math.round(fontSize * 1.25)

  return (
    <div className="overflow-x-auto">
      <div
        className="mx-auto bg-white text-black shadow-md border border-ink/10 px-3 py-4"
        style={{ width: ticket.paperDots + 24 }}
        aria-label="Print preview"
      >
        <div style={{ width: ticket.paperDots, fontFamily: '"Courier New", Courier, monospace', fontSize, lineHeight: `${lineHeight}px` }}>
          {ticket.preview.map((line, i) => {
            switch (line.kind) {
              case 'text': {
                const tall = line.size === 'tall' || line.size === 'large'
                const wide = line.size === 'wide' || line.size === 'large'
                return (
                  <div key={i} style={{ textAlign: line.align, height: lineHeight * (tall ? 2 : 1), whiteSpace: 'pre' }}>
                    <span
                      className="inline-block"
                      style={{
                        fontWeight: line.bold ? 700 : 400,
                        transform: `scale(${wide ? 2 : 1}, ${tall ? 2 : 1})`,
                        transformOrigin: ORIGIN[line.align],
                      }}
                    >
                      {line.text || ' '}
                    </span>
                  </div>
                )
              }
              case 'image':
                return <LogoImage key={i} line={line} />
              case 'qr':
                return <QrImage key={i} line={line} />
              case 'feed':
                return <div key={i} style={{ height: lineHeight * line.lines }} />
              case 'cut':
                return (
                  <div key={i} className="border-t-2 border-dashed border-ink/30 mt-1 pt-0.5 text-center text-[10px] text-ink-faint font-sans">
                    paper cut
                  </div>
                )
            }
          })}
        </div>
      </div>
    </div>
  )
}
