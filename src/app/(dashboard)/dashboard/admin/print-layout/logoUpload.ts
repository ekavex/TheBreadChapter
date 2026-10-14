// Turns an uploaded image into a 1-bit printer logo in the browser: scale to
// fit the paper, flatten transparency onto white, then threshold to black /
// white. The server only ever receives the packed bits (see LogoImage).
import { bytesToBase64 } from '@/lib/printer/template/render'
import type { LogoImage } from '@/lib/printer/template/types'

const MAX_HEIGHT = 800
const MAX_FILE_BYTES = 5 * 1024 * 1024

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })
}

// `threshold` 0-255: pixels darker than this print black.
export async function imageFileToLogo(file: File, maxWidth: number, threshold = 160): Promise<LogoImage> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG or JPG)')
  if (file.size > MAX_FILE_BYTES) throw new Error('Image is larger than 5 MB')

  const img = await loadImage(file)
  const scale = Math.min(1, maxWidth / img.naturalWidth, MAX_HEIGHT / img.naturalHeight)
  const width = Math.max(8, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image conversion is not supported in this browser')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)

  const rowBytes = Math.ceil(width / 8)
  const bits = new Uint8Array(rowBytes * height)
  let blackPixels = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (luminance < threshold) {
        bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7)
        blackPixels++
      }
    }
  }
  if (blackPixels === 0) throw new Error('The image came out blank - try a darker logo')

  return { width, height, data: bytesToBase64(bits) }
}
