// Test helper: decodes ESC/POS bytes back into printed lines with the
// printer's state at each line (alignment, bold, size, font), plus image / QR /
// feed / cut markers. Lets tests assert on what the printer would actually do,
// independent of how many redundant style commands produced it.

export type DecodedLine =
  | { kind: 'text'; text: string; align: 'left' | 'center' | 'right'; bold: boolean; tall: boolean; wide: boolean; fontB: boolean }
  | { kind: 'image'; width: number; height: number }
  | { kind: 'qr'; data: string; moduleSize: number }
  | { kind: 'feed'; lines: number }
  | { kind: 'cut' }

export function decodeEscPos(bytes: Uint8Array): DecodedLine[] {
  const out: DecodedLine[] = []
  let align: 'left' | 'center' | 'right' = 'left'
  let bold = false
  let mode = 0
  let qrModule = 0
  let qrData = ''
  let textBuf: number[] = []
  const decoder = new TextDecoder()
  const reset = () => { align = 'left'; bold = false; mode = 0 }

  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b === 0x1b) {
      const cmd = bytes[i + 1]
      if (cmd === 0x40) { reset(); i += 2; continue }
      if (cmd === 0x61) { align = (['left', 'center', 'right'] as const)[bytes[i + 2]] ?? 'left'; i += 3; continue }
      if (cmd === 0x45) { bold = bytes[i + 2] === 1; i += 3; continue }
      if (cmd === 0x21) { mode = bytes[i + 2]; i += 3; continue }
      if (cmd === 0x64) { out.push({ kind: 'feed', lines: bytes[i + 2] }); i += 3; continue }
      throw new Error(`Unknown ESC command 0x${cmd.toString(16)} at ${i}`)
    }
    if (b === 0x1d) {
      const cmd = bytes[i + 1]
      if (cmd === 0x56) { out.push({ kind: 'cut' }); i += 3; continue }
      if (cmd === 0x76) {
        const bytesPerRow = bytes[i + 4] | (bytes[i + 5] << 8)
        const height = bytes[i + 6] | (bytes[i + 7] << 8)
        out.push({ kind: 'image', width: bytesPerRow * 8, height })
        i += 8 + bytesPerRow * height
        continue
      }
      if (cmd === 0x28 && bytes[i + 2] === 0x6b) {
        const len = bytes[i + 3] | (bytes[i + 4] << 8)
        const fn = bytes[i + 6]
        if (fn === 67) qrModule = bytes[i + 7]
        if (fn === 80) qrData = decoder.decode(bytes.subarray(i + 8, i + 5 + len))
        if (fn === 81) out.push({ kind: 'qr', data: qrData, moduleSize: qrModule })
        i += 5 + len
        continue
      }
      throw new Error(`Unknown GS command 0x${cmd.toString(16)} at ${i}`)
    }
    if (b === 0x0a) {
      // An LF straight after an image / QR just ends that graphic's line.
      const prev = out[out.length - 1]
      if (textBuf.length === 0 && prev && (prev.kind === 'image' || prev.kind === 'qr') && !(prev as { lfSeen?: boolean }).lfSeen) {
        (prev as { lfSeen?: boolean }).lfSeen = true
      } else {
        out.push({
          kind: 'text', text: decoder.decode(Uint8Array.from(textBuf)), align, bold,
          tall: (mode & 0x10) !== 0, wide: (mode & 0x20) !== 0, fontB: (mode & 0x01) !== 0,
        })
      }
      textBuf = []
      i++
      continue
    }
    // NUL is ignored by printers (the legacy QR commands carry stray ones).
    if (b !== 0x00) textBuf.push(b)
    i++
  }
  return out.map((l) => {
    const { lfSeen: _ignored, ...rest } = l as DecodedLine & { lfSeen?: boolean }
    return rest as DecodedLine
  })
}

// Compact one-line-per-entry form for readable diffs in tests.
export function describe(lines: DecodedLine[]): string[] {
  return lines.map((l) => {
    switch (l.kind) {
      case 'text': {
        const flags = `${l.align[0]}${l.bold ? 'B' : '-'}${l.tall ? 'T' : '-'}${l.wide ? 'W' : '-'}${l.fontB ? 'b' : 'a'}`
        return `${flags}|${l.text}`
      }
      case 'image': return `[image ${l.width}x${l.height}]`
      case 'qr': return `[qr m${l.moduleSize} ${l.data}]`
      case 'feed': return `[feed ${l.lines}]`
      case 'cut': return '[cut]'
    }
  })
}
