import type { Draft } from 'immer'
import { CONTROL_BY_ID, readingOrder, type ControlDef } from './hardware'
import { uid, type BoardItem, type ControlState, type LayoutItem, type LedState, type MoveDoc } from './types'

export const PALETTE = [
  '#ff2a2a', '#ff5a1f', '#ff9a1a', '#ffd21a', '#c8ff2a', '#4dff3a', '#1affa0', '#1ae4ff',
  '#1a9cff', '#2a4dff', '#7a3aff', '#c43aff', '#ff3ad0', '#ff7aa8', '#ffffff', '#8a8a8a',
]

// ---- LEDs -----------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return [255, 255, 255]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** LED state that a paint colour produces on a given control. */
export function ledForPaint(def: ControlDef, paint: string): LedState | undefined {
  if (def.led === 'rgb') return paint === 'off' ? { color: null } : { color: paint }
  if (def.led === 'white') return { brightness: paint === 'off' ? 0 : Math.max(0.25, Math.round(luminance(paint) * 4) / 4) }
  return undefined
}

/** Convert an LED state copied from one control so it fits another control's LED kind. */
export function adaptLed(led: LedState | undefined, target: ControlDef): LedState | undefined {
  if (!led || target.led === 'none' || target.led === 'screen') return undefined
  if (target.led === 'rgb') {
    if (led.color !== undefined) return { color: led.color }
    const b = led.brightness ?? 0
    if (!b) return { color: null }
    const v = Math.round(b * 255).toString(16).padStart(2, '0')
    return { color: `#${v}${v}${v}` }
  }
  if (led.brightness !== undefined) return { brightness: led.brightness }
  return { brightness: led.color ? Math.max(0.25, Math.round(luminance(led.color) * 4) / 4) : 0 }
}

/** CSS colour of a lit LED, or null when off. */
export function ledCss(def: ControlDef, st: ControlState | undefined): string | null {
  const led = st?.led
  if (!led) return null
  if (def.led === 'rgb') return led.color ?? null
  if (def.led === 'white') {
    const b = led.brightness ?? 0
    return b > 0 ? `rgba(255,255,255,${0.25 + 0.75 * b})` : null
  }
  return null
}

/** The colour a paint eyedropper would pick from a control. */
export function pickColor(def: ControlDef, st: ControlState | undefined): string {
  const led = st?.led
  if (!led) return 'off'
  if (def.led === 'rgb') return led.color ?? 'off'
  const b = led.brightness ?? 0
  if (!b) return 'off'
  const v = Math.round(b * 255).toString(16).padStart(2, '0')
  return `#${v}${v}${v}`
}

// ---- control clipboard ----------------------------------------------------

export type PasteMode = 'all' | 'meta' | 'led'

export interface ControlClip {
  kind: 'amd-controls'
  items: { controlId: string; state: ControlState }[]
}

export interface BoardClip {
  kind: 'amd-board'
  items: BoardItem[]
}

export type Clip = ControlClip | BoardClip

export function copyControls(layout: LayoutItem, ids: string[]): ControlClip {
  return {
    kind: 'amd-controls',
    items: readingOrder(ids).map((id) => ({ controlId: id, state: structuredClone(layout.controls[id] ?? {}) })),
  }
}

/**
 * Paste copied control states onto targets. One source fills every target;
 * several sources map onto targets in reading order (wrapping around). With no
 * targets, sources go back onto the same control ids (handy across layouts).
 */
export function pasteControls(layout: Draft<LayoutItem>, clip: ControlClip, targets: string[], mode: PasteMode) {
  const scope = new Set(layout.scope)
  const dest = targets.length ? readingOrder(targets) : clip.items.map((i) => i.controlId)
  dest.forEach((id, i) => {
    if (!scope.has(id)) return
    const def = CONTROL_BY_ID[id]
    if (!def) return
    const src = clip.items[i % clip.items.length].state
    const cur = (layout.controls[id] ??= {})
    if (mode !== 'led') cur.meta = src.meta ? structuredClone(src.meta) : undefined
    if (mode !== 'meta') cur.led = adaptLed(src.led, def)
  })
}

export function clearControls(layout: Draft<LayoutItem>, ids: string[], mode: PasteMode) {
  const scope = new Set(layout.scope)
  for (const id of ids) {
    if (!scope.has(id)) continue
    const cur = layout.controls[id]
    if (!cur) continue
    if (mode !== 'led') delete cur.meta
    if (mode !== 'meta') delete cur.led
  }
}

// ---- board ----------------------------------------------------------------

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function boundsOf(items: Rect[]): Rect | null {
  if (!items.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of items) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h

export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Items that move along with the given ones: everything inside a moved group, recursively. */
export function withContents(doc: MoveDoc, ids: string[]): string[] {
  const out = new Set(ids)
  let grew = true
  while (grew) {
    grew = false
    for (const g of doc.items) {
      if (g.type !== 'group' || !out.has(g.id)) continue
      for (const it of doc.items) {
        if (!out.has(it.id) && it.id !== g.id && contains(g, it)) {
          out.add(it.id)
          grew = true
        }
      }
    }
  }
  return [...out]
}

/** Copy board items (plus group contents) for the clipboard, in z-order. */
export function copyBoard(doc: MoveDoc, ids: string[]): BoardClip {
  const all = new Set(withContents(doc, ids))
  return { kind: 'amd-board', items: structuredClone(doc.items.filter((i) => all.has(i.id))) }
}

/** Insert copies of clip items, offset by (dx, dy). Groups go to the back. Returns new ids. */
export function pasteBoard(doc: Draft<MoveDoc>, clip: BoardClip, dx: number, dy: number): string[] {
  const copies = clip.items.map((it) => ({ ...structuredClone(it), id: uid(), x: it.x + dx, y: it.y + dy }))
  const groups = copies.filter((c) => c.type === 'group')
  const rest = copies.filter((c) => c.type !== 'group')
  doc.items.unshift(...(groups as Draft<BoardItem>[]))
  doc.items.push(...(rest as Draft<BoardItem>[]))
  return copies.map((c) => c.id)
}

export function parseClip(text: string): Clip | null {
  try {
    const v = JSON.parse(text)
    if (v && (v.kind === 'amd-controls' || v.kind === 'amd-board') && Array.isArray(v.items)) return v
  } catch {
    /* not ours */
  }
  return null
}
