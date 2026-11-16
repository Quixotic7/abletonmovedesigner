// Screen editor engine: layered 1-bit rasters with transparency, text layers,
// compositing, dither patterns, brushes and shapes. Pure functions on typed
// arrays; the editor component owns state and history.

import { decode, encode, SCREEN_H, SCREEN_W } from './bitmap'
import { FONT_5X7 } from './font'
import { FONT_3X5 } from './font3x5'
import { uid, type RasterLayer, type ScreenFrame, type ScreenLayer, type TextLayer } from '../model/types'

export const W = SCREEN_W
export const H = SCREEN_H
export const N = W * H

/** Unpacked raster: one byte per pixel. */
export interface Raster {
  data: Uint8Array
  alpha: Uint8Array
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const emptyRaster = (): Raster => ({ data: new Uint8Array(N), alpha: new Uint8Array(N) })
export const cloneRaster = (r: Raster): Raster => ({ data: r.data.slice(), alpha: r.alpha.slice() })

// ---- (de)serialisation with a small cache --------------------------------

const decodeCache = new Map<string, Uint8Array>()
function dec(b64: string): Uint8Array {
  let v = decodeCache.get(b64)
  if (!v) {
    v = decode(b64)
    if (decodeCache.size > 400) decodeCache.clear()
    decodeCache.set(b64, v)
  }
  return v
}

export function rasterOf(l: RasterLayer): Raster {
  return { data: dec(l.data).slice(), alpha: dec(l.alpha).slice() }
}

export function withRaster(l: RasterLayer, r: Raster): RasterLayer {
  return { ...l, data: encode(r.data), alpha: encode(r.alpha) }
}

export function newRasterLayer(name: string, r: Raster = emptyRaster()): RasterLayer {
  return { id: uid(), type: 'raster', name, visible: true, x: 0, y: 0, data: encode(r.data), alpha: encode(r.alpha) }
}

export function newTextLayer(x: number, y: number, text = 'Text'): TextLayer {
  return { id: uid(), type: 'text', name: text, visible: true, x, y, text, font: 'pixel-5x7', size: 7, bold: false, ink: 1, box: false }
}

/** A frame built from a flat bitmap (used for documents made before layers existed). */
export function frameFromBitmap(b64: string): ScreenFrame {
  const data = dec(b64).slice()
  const alpha = new Uint8Array(N).fill(1)
  const bg = newRasterLayer('Background', { data, alpha })
  return { id: uid(), duration: 200, layers: [bg], image: b64 }
}

export function newFrame(): ScreenFrame {
  const bg = newRasterLayer('Background', { data: new Uint8Array(N), alpha: new Uint8Array(N).fill(1) })
  return { id: uid(), duration: 200, layers: [bg], image: encode(new Uint8Array(N)) }
}

/** Deep copy with fresh ids. */
export function cloneFrame(f: ScreenFrame): ScreenFrame {
  return { ...f, id: uid(), layers: f.layers.map((l) => ({ ...l, id: uid() })) }
}

// ---- dithers --------------------------------------------------------------

const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
]

/** Ordered-dither test: is (x, y) on at coverage `level` (0..64)? */
export const bayer = (x: number, y: number, level: number) => BAYER8[y & 7][x & 7] < level

export interface Pattern {
  id: string
  name: string
  on: (x: number, y: number) => boolean
}

export const PATTERNS: Pattern[] = [
  { id: 'solid', name: 'Solid', on: () => true },
  { id: 'd75', name: '75%', on: (x, y) => bayer(x, y, 48) },
  { id: 'd50', name: '50%', on: (x, y) => bayer(x, y, 32) },
  { id: 'd25', name: '25%', on: (x, y) => bayer(x, y, 16) },
  { id: 'd12', name: '12%', on: (x, y) => bayer(x, y, 8) },
  { id: 'd6', name: '6%', on: (x, y) => bayer(x, y, 4) },
  { id: 'hlines', name: 'H lines', on: (_x, y) => (y & 1) === 0 },
  { id: 'vlines', name: 'V lines', on: (x) => (x & 1) === 0 },
  { id: 'diag', name: 'Diagonal', on: (x, y) => (x + y) % 4 === 0 },
  { id: 'grid', name: 'Grid', on: (x, y) => x % 4 === 0 || y % 4 === 0 },
]
export const patternById = (id: string) => PATTERNS.find((p) => p.id === id) ?? PATTERNS[0]

// ---- painting ---------------------------------------------------------------

export interface Paint {
  /** 1 white, 0 black, -1 erase (transparent). */
  ink: 1 | 0 | -1
  pattern: Pattern
  /** Clip to this rect (selection). */
  clip?: Rect | null
  /** Where the pattern is off, paint the opposite colour instead of leaving it alone. */
  opaque?: boolean
  /** Screen point the pattern starts from (default: the screen's top-left). */
  origin?: { x: number; y: number }
}

/** Set one pixel in layer-local coordinates, respecting pattern and clip (in screen coords via ox/oy). */
export function plot(r: Raster, x: number, y: number, p: Paint, ox = 0, oy = 0) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const sx = x + ox
  const sy = y + oy
  if (p.clip && (sx < p.clip.x || sy < p.clip.y || sx >= p.clip.x + p.clip.w || sy >= p.clip.y + p.clip.h)) return
  const i = y * W + x
  if (!p.pattern.on(sx - (p.origin?.x ?? 0), sy - (p.origin?.y ?? 0))) {
    if (!p.opaque || p.ink === -1) return
    r.alpha[i] = 1
    r.data[i] = p.ink ? 0 : 1
    return
  }
  if (p.ink === -1) {
    r.alpha[i] = 0
    r.data[i] = 0
  } else {
    r.alpha[i] = 1
    r.data[i] = p.ink
  }
}

export type BrushShape = 'round' | 'square' | 'spray'

/** Stamp a brush centred on (cx, cy). */
export function stamp(r: Raster, cx: number, cy: number, size: number, shape: BrushShape, p: Paint, ox = 0, oy = 0) {
  if (size <= 1 && shape !== 'spray') return plot(r, cx, cy, p, ox, oy)
  const rad = size / 2
  const x0 = Math.floor(cx - rad + 0.5)
  const y0 = Math.floor(cy - rad + 0.5)
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      if (shape === 'square') plot(r, x, y, p, ox, oy)
      else {
        const dx = x + 0.5 - (x0 + rad)
        const dy = y + 0.5 - (y0 + rad)
        if (dx * dx + dy * dy > rad * rad) continue
        if (shape === 'spray' && Math.random() > 0.18) continue
        plot(r, x, y, p, ox, oy)
      }
    }
}

export function linePoints(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number) => void) {
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    fn(x0, y0)
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

export function rectShape(x0: number, y0: number, x1: number, y1: number, filled: boolean, fn: (x: number, y: number) => void) {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0]
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0]
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) if (filled || y === ay || y === by || x === ax || x === bx) fn(x, y)
}

/** Outline of a rectangle as one continuous clockwise path (so dashes run round the corners). */
export function rectPath(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0]
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0]
  if (ax === bx || ay === by) {
    const pts: [number, number][] = []
    linePoints(ax, ay, bx, by, (x, y) => pts.push([x, y]))
    return pts
  }
  const pts: [number, number][] = []
  for (let x = ax; x < bx; x++) pts.push([x, ay])
  for (let y = ay; y < by; y++) pts.push([bx, y])
  for (let x = bx; x > ax; x--) pts.push([x, by])
  for (let y = by; y > ay; y--) pts.push([ax, y])
  return pts
}

/** Outline of an ellipse as a path ordered by angle. */
export function ellipsePath(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = []
  ellipseShape(x0, y0, x1, y1, false, (x, y) => pts.push([x, y]))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return pts.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx))
}

export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'custom'

/** Dash and gap lengths for a line style (gap 0 = solid). */
export function dashOf(style: LineStyle, dash: number, gap: number, size: number): [number, number] {
  if (style === 'solid') return [1, 0]
  if (style === 'dotted') return [1, Math.max(1, size)]
  if (style === 'dashed') return [Math.max(3, size * 3), Math.max(2, size * 2)]
  return [Math.max(1, dash), Math.max(0, gap)]
}

/** Call fn for the points of `path` that fall on a dash. */
export function dashed(path: [number, number][], dash: number, gap: number, fn: (x: number, y: number) => void) {
  const period = dash + gap
  path.forEach(([x, y], i) => {
    if (!gap || i % period < dash) fn(x, y)
  })
}

export function ellipseShape(x0: number, y0: number, x1: number, y1: number, filled: boolean, fn: (x: number, y: number) => void) {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0]
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0]
  const cx = (ax + bx) / 2
  const cy = (ay + by) / 2
  const rx = (bx - ax) / 2 + 0.5
  const ry = (by - ay) / 2 + 0.5
  const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) fn(x, y)
    }
}

/** Fill a whole screen-space rect (the selection, or the screen). */
export function fillRect(r: Raster, area: Rect, p: Paint, ox = 0, oy = 0) {
  for (let sy = area.y; sy < area.y + area.h; sy++) for (let sx = area.x; sx < area.x + area.w; sx++) plot(r, sx - ox, sy - oy, p, ox, oy)
}

/** Flood fill of the region of identical (alpha, data) state around (x, y), layer-local. */
export function floodFill(r: Raster, x: number, y: number, p: Paint, ox = 0, oy = 0) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const key = (i: number) => (r.alpha[i] ? 1 + r.data[i] : 0)
  const target = key(y * W + x)
  const seen = new Uint8Array(N)
  const stack = [y * W + x]
  const region: number[] = []
  while (stack.length) {
    const i = stack.pop()!
    if (seen[i] || key(i) !== target) continue
    seen[i] = 1
    region.push(i)
    const px = i % W
    if (px > 0) stack.push(i - 1)
    if (px < W - 1) stack.push(i + 1)
    if (i >= W) stack.push(i - W)
    if (i < N - W) stack.push(i + W)
  }
  for (const i of region) plot(r, i % W, Math.floor(i / W), p, ox, oy)
}

/**
 * Dithered gradient from `ink` at A to its opposite at B, over `area` (screen
 * coords). Radial: A is the centre and B sets the radius.
 */
export function gradient(r: Raster, ax: number, ay: number, bx: number, by: number, ink: 0 | 1, radial: boolean, area: Rect, ox = 0, oy = 0) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  const len = Math.sqrt(len2)
  for (let sy = area.y; sy < area.y + area.h; sy++)
    for (let sx = area.x; sx < area.x + area.w; sx++) {
      const t = radial ? Math.hypot(sx - ax, sy - ay) / len : ((sx - ax) * dx + (sy - ay) * dy) / len2
      const level = Math.round((1 - Math.min(1, Math.max(0, t))) * 64)
      const lx = sx - ox
      const ly = sy - oy
      if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue
      const i = ly * W + lx
      r.alpha[i] = 1
      r.data[i] = bayer(sx, sy, level) ? ink : ink ? 0 : 1
    }
}

// ---- text -----------------------------------------------------------------

export interface FontDef {
  id: string
  name: string
  /** Native pixel height for pixel fonts (sizes are multiples); 0 = system font. */
  native: number
}

export const FONTS: FontDef[] = [
  { id: 'pixel-5x7', name: 'Pixel 5x7', native: 7 },
  { id: 'pixel-3x5', name: 'Pixel 3x5', native: 5 },
  { id: 'Helvetica, Arial, sans-serif', name: 'Sans (Helvetica)', native: 0 },
  { id: 'Georgia, serif', name: 'Serif (Georgia)', native: 0 },
  { id: 'Menlo, Consolas, monospace', name: 'Mono (Menlo)', native: 0 },
  { id: 'Verdana, sans-serif', name: 'Verdana', native: 0 },
  { id: 'Impact, sans-serif', name: 'Impact', native: 0 },
]
export const fontDef = (id: string) => FONTS.find((f) => f.id === id) ?? { id, name: id, native: 0 }

export interface Mask {
  w: number
  h: number
  /** 1 = ink. */
  px: Uint8Array
}

const maskCache = new Map<string, Mask>()

/** Render a text layer's glyphs to a mask (not including the box). */
export function textMask(t: TextLayer): Mask {
  const key = [t.text, t.font, t.size, t.bold].join('\u0000')
  const hit = maskCache.get(key)
  if (hit) return hit
  const m = fontDef(t.font).native ? pixelTextMask(t) : systemTextMask(t)
  if (maskCache.size > 300) maskCache.clear()
  maskCache.set(key, m)
  return m
}

function pixelTextMask(t: TextLayer): Mask {
  const def = fontDef(t.font)
  const k = Math.max(1, Math.round(t.size / def.native))
  const small = def.id === 'pixel-3x5'
  const gw = small ? 3 : 5
  const gh = small ? 5 : 8 // 5x7 has a descender row
  const adv = gw + 1
  const lineH = (small ? 6 : 9) * k
  const lines = t.text.split('\n')
  const cols = Math.max(1, ...lines.map((l) => l.length))
  const bold = t.bold ? 1 : 0
  const w = Math.max(1, (cols * adv - 1) * k + bold)
  const h = Math.max(1, (lines.length - 1) * lineH + gh * k)
  const px = new Uint8Array(w * h)
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = 1
  }
  lines.forEach((line, li) => {
    ;[...line].forEach((ch, ci) => {
      const code = ch.charCodeAt(0)
      const ox = ci * adv * k
      const oy = li * lineH
      for (let gy = 0; gy < gh; gy++)
        for (let gx = 0; gx < gw; gx++) {
          let on: boolean
          if (small) {
            const g = FONT_3X5[code - 32] ?? FONT_3X5[31]
            on = !!((g[gy] >> (2 - gx)) & 1)
          } else {
            const g = FONT_5X7[code - 32] ?? FONT_5X7[31]
            on = !!((g[gx] >> gy) & 1)
          }
          if (!on) continue
          for (let yy = 0; yy < k; yy++)
            for (let xx = 0; xx <= k - 1 + bold; xx++) set(ox + gx * k + xx, oy + gy * k + yy)
        }
    })
  })
  return { w, h, px }
}

let measureCanvas: HTMLCanvasElement | null = null
function systemTextMask(t: TextLayer): Mask {
  measureCanvas ??= document.createElement('canvas')
  const c = measureCanvas
  const size = Math.max(4, Math.round(t.size))
  const font = `${t.bold ? 'bold ' : ''}${size}px ${t.font}`
  const lines = t.text.split('\n')
  const lineH = Math.round(size * 1.2)
  let ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.font = font
  const w = Math.max(1, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 2)
  const h = Math.max(1, lineH * lines.length)
  c.width = w
  c.height = h
  ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.font = font
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#fff'
  lines.forEach((l, i) => ctx.fillText(l, 0, i * lineH))
  const img = ctx.getImageData(0, 0, w, h).data
  const px = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) px[i] = img[i * 4 + 3] >= 128 ? 1 : 0
  return trimMask({ w, h, px })
}

/** Remove empty rows/columns at the right and bottom (keeps the top-left anchor). */
function trimMask(m: Mask): Mask {
  let maxX = 0
  let maxY = 0
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (m.px[y * m.w + x]) {
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
  const w = maxX + 1
  const h = maxY + 1
  const px = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = m.px[y * m.w + x]
  return { w, h, px }
}

/** Screen-space bounds of a layer's visible content. */
export function layerBounds(l: ScreenLayer): Rect {
  if (l.type === 'text') {
    const m = textMask(l)
    const pad = l.box ? 1 : 0
    return { x: l.x - pad, y: l.y - pad, w: m.w + pad * 2, h: m.h + pad * 2 }
  }
  const a = dec(l.alpha)
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (a[y * W + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return { x: l.x, y: l.y, w: 0, h: 0 }
  return { x: x0 + l.x, y: y0 + l.y, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

// ---- compositing ------------------------------------------------------------

/** Draw a layer onto `out` (screen pixels, 0/1). `override` replaces a raster layer's pixels. */
export function drawLayer(out: Uint8Array, l: ScreenLayer, override?: Raster) {
  if (l.type === 'raster') {
    const data = override?.data ?? dec(l.data)
    const alpha = override?.alpha ?? dec(l.alpha)
    for (let y = 0; y < H; y++) {
      const sy = y + l.y
      if (sy < 0 || sy >= H) continue
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (!alpha[i]) continue
        const sx = x + l.x
        if (sx < 0 || sx >= W) continue
        out[sy * W + sx] = data[i]
      }
    }
    return
  }
  const m = textMask(l)
  if (l.box) {
    for (let y = -1; y <= m.h; y++)
      for (let x = -1; x <= m.w; x++) {
        const sx = l.x + x
        const sy = l.y + y
        if (sx >= 0 && sy >= 0 && sx < W && sy < H) out[sy * W + sx] = l.ink ? 0 : 1
      }
  }
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      if (!m.px[y * m.w + x]) continue
      const sx = l.x + x
      const sy = l.y + y
      if (sx >= 0 && sy >= 0 && sx < W && sy < H) out[sy * W + sx] = l.ink
    }
}

export function composite(layers: ScreenLayer[], overrides?: Map<string, Raster>, hidden?: Set<string>): Uint8Array {
  const out = new Uint8Array(N)
  for (const l of layers) if (l.visible && !hidden?.has(l.id)) drawLayer(out, l, overrides?.get(l.id))
  return out
}

export const flatten = (layers: ScreenLayer[]) => encode(composite(layers))

/** Convert any layer to an equivalent raster layer at offset 0, 0. */
export function rasterize(l: ScreenLayer): RasterLayer {
  const r = emptyRaster()
  if (l.type === 'raster') {
    const src = rasterOf(l)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (!src.alpha[i]) continue
        const sx = x + l.x
        const sy = y + l.y
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
        r.alpha[sy * W + sx] = 1
        r.data[sy * W + sx] = src.data[i]
      }
  } else {
    // Draw onto a sentinel buffer so we know which pixels the text touched.
    const out = new Uint8Array(N).fill(2)
    drawLayer(out, l)
    for (let i = 0; i < N; i++)
      if (out[i] !== 2) {
        r.alpha[i] = 1
        r.data[i] = out[i]
      }
  }
  return { id: l.id, type: 'raster', name: l.name, visible: l.visible, x: 0, y: 0, data: encode(r.data), alpha: encode(r.alpha) }
}

/** Merge `top` onto `bottom` (both rasterised). */
export function mergeDown(bottom: ScreenLayer, top: ScreenLayer): RasterLayer {
  const b = rasterize(bottom)
  const t = rasterize(top)
  const rb = rasterOf(b)
  const rt = rasterOf(t)
  for (let i = 0; i < N; i++)
    if (rt.alpha[i]) {
      rb.alpha[i] = 1
      rb.data[i] = rt.data[i]
    }
  return withRaster(b, rb)
}

// ---- selections -------------------------------------------------------------

export interface Clip {
  w: number
  h: number
  data: Uint8Array
  alpha: Uint8Array
  /** Where it was copied from (screen coords). */
  x: number
  y: number
}

/** Copy a screen-space rect out of a raster layer. */
export function copyRect(l: RasterLayer, r: Raster, sel: Rect): Clip {
  const out: Clip = { w: sel.w, h: sel.h, data: new Uint8Array(sel.w * sel.h), alpha: new Uint8Array(sel.w * sel.h), x: sel.x, y: sel.y }
  for (let y = 0; y < sel.h; y++)
    for (let x = 0; x < sel.w; x++) {
      const lx = sel.x + x - l.x
      const ly = sel.y + y - l.y
      if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue
      out.data[y * sel.w + x] = r.data[ly * W + lx]
      out.alpha[y * sel.w + x] = r.alpha[ly * W + lx]
    }
  return out
}

export function clearRect(l: RasterLayer, r: Raster, sel: Rect) {
  for (let y = sel.y; y < sel.y + sel.h; y++)
    for (let x = sel.x; x < sel.x + sel.w; x++) {
      const lx = x - l.x
      const ly = y - l.y
      if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue
      r.alpha[ly * W + lx] = 0
      r.data[ly * W + lx] = 0
    }
}

/** Paste a clip into a raster at screen position (x, y) (opaque pixels only). */
export function pasteClip(l: RasterLayer, r: Raster, c: Clip, x: number, y: number) {
  for (let cy = 0; cy < c.h; cy++)
    for (let cx = 0; cx < c.w; cx++) {
      const i = cy * c.w + cx
      if (!c.alpha[i]) continue
      const lx = x + cx - l.x
      const ly = y + cy - l.y
      if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue
      r.alpha[ly * W + lx] = 1
      r.data[ly * W + lx] = c.data[i]
    }
}

export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  const x = Math.max(0, Math.min(x0, x1))
  const y = Math.max(0, Math.min(y0, y1))
  const xe = Math.min(W - 1, Math.max(x0, x1))
  const ye = Math.min(H - 1, Math.max(y0, y1))
  return { x, y, w: Math.max(0, xe - x + 1), h: Math.max(0, ye - y + 1) }
}

export const inRect = (r: Rect | null | undefined, x: number, y: number) => !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h
