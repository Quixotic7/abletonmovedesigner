import { useStore, type View } from './store'
import { boundsOf, type Rect } from './model/ops'
import type { BoardItem } from './model/types'

/** The board element, set by <Board>. */
export const boardRef: { el: HTMLDivElement | null } = { el: null }

export const MIN_SCALE = 0.04
export const MAX_SCALE = 8

/** Layout card geometry: where the device drawing sits inside a layout item. */
export const CARD_DEVICE_X = 20
export const CARD_SVG_Y = 108
export const CARD_DEVICE_Y = 130 // CARD_SVG_Y - SURFACE_TOP

export function boardRect() {
  return boardRef.el?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}

export function screenToWorld(clientX: number, clientY: number, v: View = useStore.getState().view) {
  const r = boardRect()
  return { x: (clientX - r.left - v.x) / v.scale, y: (clientY - r.top - v.y) / v.scale }
}

export function zoomAt(clientX: number, clientY: number, factor: number) {
  const { view, setView } = useStore.getState()
  const r = boardRect()
  const px = clientX - r.left
  const py = clientY - r.top
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor))
  const k = scale / view.scale
  setView({ scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k })
}

export function zoomCenter(factor: number) {
  const r = boardRect()
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor)
}

/** View that fits a world rect into the board, leaving `rightInset` px free (inspector). */
export function viewForRect(rect: Rect, rightInset = 0, pad = 60, maxScale = 2): View {
  const r = boardRect()
  const w = Math.max(100, r.width - rightInset - pad * 2)
  const h = Math.max(100, r.height - pad * 2 - 50)
  const scale = Math.min(maxScale, Math.max(MIN_SCALE, Math.min(w / rect.w, h / rect.h)))
  return {
    scale,
    x: pad + (w - rect.w * scale) / 2 - rect.x * scale,
    y: pad + 50 + (h - rect.h * scale) / 2 - rect.y * scale,
  }
}

export const INSPECTOR_W = 320

export function zoomToFit(items?: BoardItem[]) {
  const s = useStore.getState()
  const b = boundsOf(items ?? s.doc.items)
  if (!b) return s.setView({ x: 40, y: 40, scale: 0.6 })
  const inspector = s.activeLayoutId || s.selection.length === 1
  s.setView(viewForRect(b, inspector ? INSPECTOR_W : 0, 60, 1))
}

export function zoomToSelection() {
  const s = useStore.getState()
  const items = s.doc.items.filter((i) => s.selection.includes(i.id))
  zoomToFit(items.length ? items : undefined)
}

/** Zoom in on one layout and make it the active (edited) layout. Esc returns to the previous view. */
export function focusLayout(id: string) {
  const s = useStore.getState()
  const it = s.doc.items.find((i) => i.id === id)
  if (!it) return
  s.set({ returnView: s.returnView ?? s.view, selection: [id] })
  s.activate(id, [])
  s.setView(viewForRect(it, INSPECTOR_W, 40, 3))
}

/** Leave the active layout; restores the view from before focusLayout(). */
export function leaveLayout() {
  const s = useStore.getState()
  if (s.returnView) s.setView(s.returnView)
  s.set({ returnView: null, tool: s.tool, scopeEdit: false })
  s.activate(null)
}
