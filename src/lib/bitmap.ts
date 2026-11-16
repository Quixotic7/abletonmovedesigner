// 128x64 1-bit bitmap helpers. Storage format: 1024 bytes, row-major,
// 16 bytes per row, most significant bit = leftmost pixel. Serialised as base64.

import { FONT_5X7 } from './font'

export const SCREEN_W = 128
export const SCREEN_H = 64
const BYTES = (SCREEN_W * SCREEN_H) / 8

/** Unpacked bitmap: one byte per pixel (0/1), length 8192. */
export type Pixels = Uint8Array

export function emptyScreen(): string {
  return encode(new Uint8Array(SCREEN_W * SCREEN_H))
}

export function decode(b64: string): Pixels {
  const px = new Uint8Array(SCREEN_W * SCREEN_H)
  let bin = ''
  try {
    bin = atob(b64)
  } catch {
    return px
  }
  for (let i = 0; i < Math.min(bin.length, BYTES); i++) {
    const byte = bin.charCodeAt(i)
    for (let b = 0; b < 8; b++) px[i * 8 + b] = (byte >> (7 - b)) & 1
  }
  return px
}

export function encode(px: Pixels): string {
  let bin = ''
  for (let i = 0; i < BYTES; i++) {
    let byte = 0
    for (let b = 0; b < 8; b++) byte |= (px[i * 8 + b] ? 1 : 0) << (7 - b)
    bin += String.fromCharCode(byte)
  }
  return btoa(bin)
}

export function set(px: Pixels, x: number, y: number, v: number) {
  if (x < 0 || y < 0 || x >= SCREEN_W || y >= SCREEN_H) return
  px[y * SCREEN_W + x] = v
}

export function get(px: Pixels, x: number, y: number) {
  if (x < 0 || y < 0 || x >= SCREEN_W || y >= SCREEN_H) return 0
  return px[y * SCREEN_W + x]
}

export function line(px: Pixels, x0: number, y0: number, x1: number, y1: number, v: number) {
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    set(px, x0, y0, v)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}

export function rect(px: Pixels, x0: number, y0: number, x1: number, y1: number, v: number, filled: boolean) {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0]
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0]
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) if (filled || y === ay || y === by || x === ax || x === bx) set(px, x, y, v)
}

export function fill(px: Pixels, x: number, y: number, v: number) {
  const target = get(px, x, y)
  if (target === v) return
  const stack = [[x, y]]
  while (stack.length) {
    const [cx, cy] = stack.pop()!
    if (cx < 0 || cy < 0 || cx >= SCREEN_W || cy >= SCREEN_H) continue
    if (px[cy * SCREEN_W + cx] !== target) continue
    px[cy * SCREEN_W + cx] = v
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
  }
}

/** Draw text with the 5x7 font (6 px advance, 8 px line height). Top-left at (x, y). */
export function text(px: Pixels, x: number, y: number, str: string, v: number) {
  let cx = x
  let cy = y
  for (const ch of str) {
    if (ch === '\n') {
      cx = x
      cy += 9
      continue
    }
    const code = ch.charCodeAt(0)
    const glyph = FONT_5X7[code - 32] ?? FONT_5X7[31] // '?'
    for (let col = 0; col < 5; col++) {
      const bits = glyph[col]
      for (let row = 0; row < 8; row++) if ((bits >> row) & 1) set(px, cx + col, cy + row, v)
    }
    cx += 6
  }
}

export function textWidth(str: string) {
  return Math.max(0, ...str.split('\n').map((l) => l.length * 6 - 1))
}

/** Render to a canvas (white on black) at 1 px per pixel. */
export function toCanvas(px: Pixels, canvas: HTMLCanvasElement, on = [255, 255, 255], off = [0, 0, 0]) {
  canvas.width = SCREEN_W
  canvas.height = SCREEN_H
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(SCREEN_W, SCREEN_H)
  for (let i = 0; i < px.length; i++) {
    const c = px[i] ? on : off
    img.data[i * 4] = c[0]
    img.data[i * 4 + 1] = c[1]
    img.data[i * 4 + 2] = c[2]
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

const urlCache = new Map<string, string>()
/** data: URL for a stored screen, cached. */
export function screenDataUrl(b64: string): string {
  const hit = urlCache.get(b64)
  if (hit) return hit
  const c = document.createElement('canvas')
  toCanvas(decode(b64), c)
  const url = c.toDataURL()
  if (urlCache.size > 200) urlCache.clear()
  urlCache.set(b64, url)
  return url
}

export function isBlank(b64: string) {
  return decode(b64).every((v) => v === 0)
}
