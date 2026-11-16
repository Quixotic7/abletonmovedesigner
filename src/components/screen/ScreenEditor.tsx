import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, findScreenHost } from '../../store'
import { uid, type RasterLayer, type ScreenFrame, type ScreenLayer, type TextLayer } from '../../model/types'
import * as S from '../../lib/screen'
import { MOD } from '../../shortcuts'
import { SidePanel } from './SidePanel'
import { FramesStrip } from './FramesStrip'

export type Tool = 'select' | 'move' | 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'gradient' | 'text'

export const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Box select', key: 'M', icon: '⬚' },
  { id: 'move', label: 'Move layer', key: 'V', icon: '✥' },
  { id: 'brush', label: 'Brush', key: 'B', icon: '✎' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: '⌫' },
  { id: 'line', label: 'Line', key: 'L', icon: '╱' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: '▭' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: '◯' },
  { id: 'fill', label: 'Fill', key: 'G', icon: '◧' },
  { id: 'gradient', label: 'Dither gradient', key: 'D', icon: '▤' },
  { id: 'text', label: 'Text', key: 'T', icon: 'T' },
]

export interface ToolOpts {
  ink: 0 | 1
  pattern: string
  size: number
  shape: S.BrushShape
  /** Rect / ellipse: draw the outline (with ink, size, dither and line style above). */
  outline: boolean
  /** Rect / ellipse: fill the inside, with its own colour and dither. */
  fill: boolean
  fillInk: 0 | 1
  fillPattern: string
  /** Lines and outlines. */
  lineStyle: S.LineStyle
  dash: number
  gap: number
  radial: boolean
  /** Dither gaps take the other colour (true) or stay transparent (false). */
  opaque: boolean
  /** Fill tool: the detected area, or the whole selection (or screen). */
  fillMode: 'area' | 'selection'
}

type Clipboard = { kind: 'pixels'; clip: S.Clip } | { kind: 'layer'; layer: ScreenLayer }
/** Shared across editor sessions and layouts, so you can copy between frames and layouts. */
let clipboard: Clipboard | null = null

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | {
      kind: 'paint'
      layer: RasterLayer
      r: S.Raster
      paint: S.Paint
      lx: number
      ly: number
      /** Shift axis lock: where Shift was first held, and the locked axis once known. */
      lock: { x: number; y: number; axis: 'h' | 'v' | null } | null
    }
  | { kind: 'shape'; layer: RasterLayer; base: S.Raster; paint: S.Paint; alt: boolean; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'gradient'; layer: RasterLayer; base: S.Raster; ink: 0 | 1; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'select'; x0: number; y0: number }
  | { kind: 'float'; layer: RasterLayer; base: S.Raster; clip: S.Clip; sx: number; sy: number; dx: number; dy: number }
  | { kind: 'moveLayer'; id: string; ox: number; oy: number; sx: number; sy: number; moved: boolean }
  | { kind: 'textResize'; layer: TextLayer; corner: Corner; b: S.Rect }

type Corner = 'tl' | 'tr' | 'bl' | 'br'
const TEXT_HANDLE_TOOLS: Tool[] = ['text', 'move', 'select']

interface View {
  x: number
  y: number
  scale: number
}

function handlePoints(b: S.Rect, v: { x: number; y: number; scale: number }): [number, number, Corner][] {
  const x0 = v.x + b.x * v.scale
  const y0 = v.y + b.y * v.scale
  const x1 = v.x + (b.x + b.w) * v.scale
  const y1 = v.y + (b.y + b.h) * v.scale
  return [
    [x0, y0, 'tl'],
    [x1, y0, 'tr'],
    [x0, y1, 'bl'],
    [x1, y1, 'br'],
  ]
}

/** Text layer resized by dragging `corner` to the fractional pixel (fx, fy); the opposite corner stays put. */
function resizedText(t: TextLayer, b: S.Rect, corner: Corner, fx: number, fy: number): Partial<TextLayer> {
  const left = corner === 'tl' || corner === 'bl'
  const top = corner === 'tl' || corner === 'tr'
  const w = Math.max(1, left ? b.x + b.w - fx : fx - b.x)
  const h = Math.max(1, top ? b.y + b.h - fy : fy - b.y)
  const ratio = Math.max(w / b.w, h / b.h)
  const def = S.fontDef(t.font)
  const size = def.native ? def.native * Math.max(1, Math.round((t.size * ratio) / def.native)) : Math.max(5, Math.min(64, Math.round(t.size * ratio)))
  const nb = S.layerBounds({ ...t, size })
  const x = t.x + (left ? b.x + b.w - (nb.x + nb.w) : 0)
  const y = t.y + (top ? b.y + b.h - (nb.y + nb.h) : 0)
  return { size, x, y }
}

export function ScreenEditor({ layoutId }: { layoutId: string }) {
  const layout = useStore((s) => findScreenHost(s.doc, layoutId))
  const commit = useStore((s) => s.commit)
  const close = () => useStore.getState().set({ dialog: null })

  const frames: ScreenFrame[] = useMemo(
    () => layout?.screenFrames ?? [S.frameFromBitmap(layout?.screen ?? '')],
    [layout?.screenFrames, layout?.screen],
  )
  const [frameIdx, setFrameIdx] = useState(0)
  const fi = Math.min(frameIdx, frames.length - 1)
  const frame = frames[fi]
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = frame.layers.find((l) => l.id === activeId) ?? frame.layers[frame.layers.length - 1]

  const [tool, setTool] = useState<Tool>('brush')
  const [opts, setOpts] = useState<ToolOpts>({ ink: 1, pattern: 'solid', size: 1, shape: 'round', outline: true, fill: false, fillInk: 1, fillPattern: 'd50', lineStyle: 'solid', dash: 4, gap: 2, radial: false, opaque: true, fillMode: 'area' })
  const [sel, setSel] = useState<S.Rect | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 6 })
  const [playing, setPlaying] = useState(false)
  const [onion, setOnion] = useState(false)
  const [grid, setGrid] = useState(true)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [focusText, setFocusText] = useState(0)
  const [hoverCursor, setHoverCursor] = useState<string | null>(null)

  const vpRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const preview = useRef<{ overrides?: Map<string, S.Raster>; patch?: Map<string, Partial<TextLayer>>; sel?: S.Rect | null }>({})
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const fitted = useRef(false)

  // ---- persistence -------------------------------------------------------

  /** Replace one frame's layers (one undo step, or merged with `key` while typing). */
  const saveLayers = useCallback(
    (layers: ScreenLayer[], key?: string, idx = fi) => {
      commit((d) => {
        const l = findScreenHost(d, layoutId)
        if (!l) return
        const fs = (l.screenFrames ?? frames).map((f) => ({ ...f }))
        fs[idx] = { ...fs[idx], layers, image: S.flatten(layers) }
        l.screenFrames = fs
        l.screen = fs[0].image
      }, key)
    },
    [commit, layoutId, frames, fi],
  )

  const saveFrames = useCallback(
    (fs: ScreenFrame[]) => {
      commit((d) => {
        const l = findScreenHost(d, layoutId)
        if (!l) return
        l.screenFrames = fs
        l.screen = fs[0].image
      })
    },
    [commit, layoutId],
  )

  const updateLayer = (id: string, patch: Partial<TextLayer> | Partial<RasterLayer>, key?: string) =>
    saveLayers(
      frame.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as ScreenLayer) : l)),
      key,
    )

  // ---- drawing -----------------------------------------------------------

  const offscreen = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = S.W
    c.height = S.H
    return c
  }, [])

  const draw = useCallback(() => {
    const c = canvasRef.current
    const vp = vpRef.current
    if (!c || !vp) return
    const dpr = window.devicePixelRatio || 1
    const cw = vp.clientWidth
    const ch = vp.clientHeight
    if (c.width !== cw * dpr || c.height !== ch * dpr) {
      c.width = cw * dpr
      c.height = ch * dpr
      c.style.width = cw + 'px'
      c.style.height = ch + 'px'
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#121316'
    ctx.fillRect(0, 0, cw, ch)

    const p = preview.current
    let layers = frame.layers
    if (p.patch) layers = layers.map((l) => (p.patch!.has(l.id) ? ({ ...l, ...p.patch!.get(l.id)! } as ScreenLayer) : l))
    const px = S.composite(layers, p.overrides)
    const prev = onion && fi > 0 ? S.composite(frames[fi - 1].layers) : null

    const octx = offscreen.getContext('2d')!
    const img = octx.createImageData(S.W, S.H)
    for (let i = 0; i < S.N; i++) {
      const on = px[i]
      const ghost = prev && prev[i] && !on
      img.data[i * 4] = on ? 255 : ghost ? 120 : 0
      img.data[i * 4 + 1] = on ? 255 : ghost ? 60 : 0
      img.data[i * 4 + 2] = on ? 255 : ghost ? 60 : 0
      img.data[i * 4 + 3] = 255
    }
    octx.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = false
    const { x: vx, y: vy, scale: k } = view
    ctx.drawImage(offscreen, vx, vy, S.W * k, S.H * k)

    if (grid && k >= 6) {
      ctx.strokeStyle = 'rgba(110,130,160,0.22)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 1; x < S.W; x++) {
        const X = Math.round(vx + x * k) + 0.5
        ctx.moveTo(X, vy)
        ctx.lineTo(X, vy + S.H * k)
      }
      for (let y = 1; y < S.H; y++) {
        const Y = Math.round(vy + y * k) + 0.5
        ctx.moveTo(vx, Y)
        ctx.lineTo(vx + S.W * k, Y)
      }
      ctx.stroke()
      ctx.strokeStyle = 'rgba(110,150,255,0.4)'
      ctx.beginPath()
      for (let x = 8; x < S.W; x += 8) {
        const X = Math.round(vx + x * k) + 0.5
        ctx.moveTo(X, vy)
        ctx.lineTo(X, vy + S.H * k)
      }
      for (let y = 8; y < S.H; y += 8) {
        const Y = Math.round(vy + y * k) + 0.5
        ctx.moveTo(vx, Y)
        ctx.lineTo(vx + S.W * k, Y)
      }
      ctx.stroke()
    }
    ctx.strokeStyle = '#4a4b52'
    ctx.strokeRect(vx - 0.5, vy - 0.5, S.W * k + 1, S.H * k + 1)

    const rectOut = (r: S.Rect, color: string, dash: number[]) => {
      ctx.setLineDash(dash)
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.strokeRect(vx + r.x * k + 0.5, vy + r.y * k + 0.5, r.w * k - 1, r.h * k - 1)
      ctx.setLineDash([])
    }
    // Active layer outline (text layers and moved rasters).
    if (active && active.visible && (active.type === 'text' || active.x || active.y || tool === 'move')) {
      const pt = p.patch?.get(active.id)
      const b = S.layerBounds(pt ? ({ ...active, ...pt } as ScreenLayer) : active)
      if (b.w && b.h) {
        rectOut(b, '#ff8a3d', [4, 3])
        if (active.type === 'text' && TEXT_HANDLE_TOOLS.includes(tool)) {
          // Corner handles for WYSIWYG resizing.
          ctx.fillStyle = '#ff8a3d'
          ctx.strokeStyle = '#000'
          ctx.lineWidth = 1
          for (const [hx, hy] of handlePoints(b, view)) {
            ctx.fillRect(hx - 4, hy - 4, 8, 8)
            ctx.strokeRect(hx - 4.5, hy - 4.5, 9, 9)
          }
        }
      }
    }
    const s = p.sel !== undefined ? p.sel : sel
    if (s && s.w && s.h) {
      rectOut(s, '#000', [])
      rectOut(s, '#4da3ff', [5, 4])
    }
    // Brush footprint.
    if (cursor && !gesture.current && ['brush', 'eraser', 'line', 'rect', 'ellipse'].includes(tool)) {
      const size = opts.size
      const x0 = Math.floor(cursor.x - size / 2 + 0.5)
      const y0 = Math.floor(cursor.y - size / 2 + 0.5)
      ctx.strokeStyle = 'rgba(255,138,61,0.9)'
      ctx.lineWidth = 1
      ctx.strokeRect(vx + x0 * k + 0.5, vy + y0 * k + 0.5, size * k - 1, size * k - 1)
    }
  }, [frame, frames, fi, onion, view, grid, sel, cursor, tool, opts.size, active, offscreen])

  useEffect(draw, [draw])

  const fit = useCallback(() => {
    const vp = vpRef.current
    if (!vp) return
    const k = Math.max(1, Math.floor(Math.min((vp.clientWidth - 40) / S.W, (vp.clientHeight - 40) / S.H)))
    setView({ scale: k, x: Math.round((vp.clientWidth - S.W * k) / 2), y: Math.round((vp.clientHeight - S.H * k) / 2) })
  }, [])

  useEffect(() => {
    const vp = vpRef.current!
    const ro = new ResizeObserver(() => {
      if (!fitted.current) {
        fitted.current = true
        fit()
      } else draw()
    })
    ro.observe(vp)
    return () => ro.disconnect()
  }, [fit, draw])

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const r = vpRef.current!.getBoundingClientRect()
    const px = clientX - r.left
    const py = clientY - r.top
    setView((v) => {
      const scale = Math.min(48, Math.max(1, v.scale * factor))
      const kk = scale / v.scale
      return { scale, x: px - (px - v.x) * kk, y: py - (py - v.y) * kk }
    })
  }, [])

  useEffect(() => {
    const vp = vpRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const dx = e.deltaX * unit
      const dy = e.deltaY * unit
      const clamp = (v: number) => Math.max(-60, Math.min(60, v))
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-clamp(dy) * 0.01))
      else if (Math.abs(dx) > Math.abs(dy) || e.shiftKey) setView((v) => ({ ...v, x: v.x - (e.shiftKey && !dx ? dy : dx), y: v.y - (e.shiftKey && !dx ? 0 : dy) }))
      else zoomAt(e.clientX, e.clientY, Math.exp(-clamp(dy) * 0.006))
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // ---- animation playback -----------------------------------------------

  useEffect(() => {
    if (!playing) return
    const t = window.setTimeout(() => setFrameIdx((i) => (i + 1) % frames.length), Math.max(16, frames[fi]?.duration ?? 200))
    return () => window.clearTimeout(t)
  }, [playing, fi, frames])

  // ---- pointer -----------------------------------------------------------

  const toPixel = (clientX: number, clientY: number) => {
    const r = vpRef.current!.getBoundingClientRect()
    return { x: Math.floor((clientX - r.left - view.x) / view.scale), y: Math.floor((clientY - r.top - view.y) / view.scale) }
  }

  /** The raster layer to paint on: the active one, or a new one above a text layer. */
  const paintTarget = (): { layer: RasterLayer; layers: ScreenLayer[] } => {
    if (active?.type === 'raster') return { layer: active, layers: frame.layers }
    const layer = S.newRasterLayer(`Layer ${frame.layers.length + 1}`)
    const idx = active ? frame.layers.indexOf(active) + 1 : frame.layers.length
    const layers = [...frame.layers.slice(0, idx), layer, ...frame.layers.slice(idx)]
    return { layer, layers }
  }
  const pendingLayers = useRef<ScreenLayer[] | null>(null)

  /** Topmost visible layer with content at (x, y). */
  const layerAt = (x: number, y: number): ScreenLayer | undefined => {
    for (let i = frame.layers.length - 1; i >= 0; i--) {
      const l = frame.layers[i]
      if (!l.visible) continue
      if (l.type === 'text') {
        if (S.inRect(S.layerBounds(l), x, y)) return l
      } else {
        const lx = x - l.x
        const ly = y - l.y
        if (lx >= 0 && ly >= 0 && lx < S.W && ly < S.H && S.rasterOf(l).alpha[ly * S.W + lx]) return l
      }
    }
    return undefined
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (playing) setPlaying(false)
    const vp = vpRef.current!
    try {
      vp.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault()
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
      return
    }
    if (e.button !== 0 && e.button !== 2) return
    const { x, y } = toPixel(e.clientX, e.clientY)
    const alt = e.button === 2 || e.altKey
    const ink: 0 | 1 = alt ? (opts.ink ? 0 : 1) : opts.ink
    const pattern = S.patternById(opts.pattern)

    // Active text layer: corner handles resize, dragging inside the box moves it.
    if (active?.type === 'text' && active.visible && TEXT_HANDLE_TOOLS.includes(tool) && e.button === 0) {
      const b = S.layerBounds(active)
      const r = vpRef.current!.getBoundingClientRect()
      const hit = handlePoints(b, view).find(([hx, hy]) => Math.abs(e.clientX - r.left - hx) <= 7 && Math.abs(e.clientY - r.top - hy) <= 7)
      if (hit) {
        gesture.current = { kind: 'textResize', layer: active, corner: hit[2], b }
        return
      }
      if (S.inRect(b, x, y) && !(tool === 'select' && S.inRect(sel, x, y))) {
        gesture.current = { kind: 'moveLayer', id: active.id, ox: active.x, oy: active.y, sx: x, sy: y, moved: false }
        return
      }
    }

    switch (tool) {
      case 'move': {
        const hit = layerAt(x, y) ?? active
        if (!hit) return
        setActiveId(hit.id)
        gesture.current = { kind: 'moveLayer', id: hit.id, ox: hit.x, oy: hit.y, sx: x, sy: y, moved: false }
        return
      }
      case 'text': {
        const hit = layerAt(x, y)
        if (hit?.type === 'text') {
          setActiveId(hit.id)
          setFocusText((n) => n + 1)
          gesture.current = { kind: 'moveLayer', id: hit.id, ox: hit.x, oy: hit.y, sx: x, sy: y, moved: false }
          return
        }
        const t = S.newTextLayer(Math.max(0, x), Math.max(0, y))
        t.ink = ink
        const idx = active ? frame.layers.indexOf(active) + 1 : frame.layers.length
        saveLayers([...frame.layers.slice(0, idx), t, ...frame.layers.slice(idx)])
        setActiveId(t.id)
        setFocusText((n) => n + 1)
        return
      }
      case 'select': {
        const textHit = !S.inRect(sel, x, y) ? layerAt(x, y) : undefined
        if (textHit?.type === 'text') {
          setActiveId(textHit.id)
          gesture.current = { kind: 'moveLayer', id: textHit.id, ox: textHit.x, oy: textHit.y, sx: x, sy: y, moved: false }
          return
        }
        if (sel && S.inRect(sel, x, y) && active?.type === 'raster') {
          const base = S.rasterOf(active)
          const clip = S.copyRect(active, base, sel)
          S.clearRect(active, base, sel)
          gesture.current = { kind: 'float', layer: active, base, clip, sx: x, sy: y, dx: 0, dy: 0 }
          return
        }
        gesture.current = { kind: 'select', x0: x, y0: y }
        preview.current = { sel: S.normRect(x, y, x, y) }
        draw()
        return
      }
    }

    // Raster tools.
    const { layer, layers } = paintTarget()
    pendingLayers.current = layers !== frame.layers ? layers : null
    if (layers !== frame.layers) setActiveId(layer.id)
    const lx = x - layer.x
    const ly = y - layer.y
    const paint: S.Paint = { ink: tool === 'eraser' ? -1 : ink, pattern: tool === 'eraser' ? S.PATTERNS[0] : pattern, clip: sel, opaque: opts.opaque }
    const base = S.rasterOf(layer)
    if (tool === 'fill') {
      // Shift-click does the other fill mode.
      const whole = (opts.fillMode === 'selection') !== e.shiftKey
      const fillPaint = { ...paint, origin: { x, y } } // the dither starts where you click
      if (whole) S.fillRect(base, sel ?? { x: 0, y: 0, w: S.W, h: S.H }, fillPaint, layer.x, layer.y)
      else S.floodFill(base, lx, ly, fillPaint, layer.x, layer.y)
      finishRaster(layer, base)
      return
    }
    if (tool === 'brush' || tool === 'eraser') {
      const last = lastPoint.current
      if (e.shiftKey && last) S.linePoints(last.x - layer.x, last.y - layer.y, lx, ly, (px, py) => S.stamp(base, px, py, opts.size, opts.shape, paint, layer.x, layer.y))
      else S.stamp(base, lx, ly, opts.size, opts.shape, paint, layer.x, layer.y)
      gesture.current = { kind: 'paint', layer, r: base, paint, lx, ly, lock: null }
      preview.current = { overrides: new Map([[layer.id, base]]) }
      lastPoint.current = { x, y }
      draw()
      return
    }
    if (tool === 'gradient') {
      gesture.current = { kind: 'gradient', layer, base, ink, x0: x, y0: y, x1: x, y1: y }
      return
    }
    // Shapes start their dither pattern at the point you clicked.
    gesture.current = { kind: 'shape', layer, base, paint: { ...paint, origin: { x, y } }, alt, x0: x, y0: y, x1: x, y1: y }
    updateShape()
  }

  function shapePreview(g: Extract<Gesture, { kind: 'shape' | 'gradient' }>) {
    const r = S.cloneRaster(g.base)
    const { layer } = g
    if (g.kind === 'gradient') {
      const area = sel ?? { x: 0, y: 0, w: S.W, h: S.H }
      S.gradient(r, g.x0, g.y0, g.x1, g.y1, g.ink, opts.radial, area, layer.x, layer.y)
      return r
    }
    const stampAt = (x: number, y: number) => S.stamp(r, x - layer.x, y - layer.y, opts.size, opts.shape, g.paint, layer.x, layer.y)
    const [dash, gap] = S.dashOf(opts.lineStyle, opts.dash, opts.gap, opts.size)
    if (tool === 'line') {
      const path: [number, number][] = []
      S.linePoints(g.x0, g.y0, g.x1, g.y1, (x, y) => path.push([x, y]))
      S.dashed(path, dash, gap, stampAt)
      return r
    }
    // Rect / ellipse: fill first, then the outline on top.
    if (opts.fill) {
      const fillInk: 0 | 1 = g.alt ? (opts.fillInk ? 0 : 1) : opts.fillInk
      const fillPaint: S.Paint = { ...g.paint, ink: fillInk, pattern: S.patternById(opts.fillPattern) }
      const plotFill = (x: number, y: number) => S.plot(r, x - layer.x, y - layer.y, fillPaint, layer.x, layer.y)
      if (tool === 'rect') S.rectShape(g.x0, g.y0, g.x1, g.y1, true, plotFill)
      else S.ellipseShape(g.x0, g.y0, g.x1, g.y1, true, plotFill)
    }
    if (opts.outline) S.dashed(tool === 'rect' ? S.rectPath(g.x0, g.y0, g.x1, g.y1) : S.ellipsePath(g.x0, g.y0, g.x1, g.y1), dash, gap, stampAt)
    return r
  }

  function updateShape() {
    const g = gesture.current
    if (!g || (g.kind !== 'shape' && g.kind !== 'gradient')) return
    preview.current = { overrides: new Map([[g.layer.id, shapePreview(g)]]) }
    draw()
  }

  function finishRaster(layer: RasterLayer, r: S.Raster) {
    const layers = pendingLayers.current ?? frame.layers
    pendingLayers.current = null
    saveLayers(layers.map((l) => (l.id === layer.id ? S.withRaster(layer, r) : l)))
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = toPixel(e.clientX, e.clientY)
    setCursor((c) => (c && c.x === x && c.y === y ? c : { x, y }))
    const g = gesture.current
    if (!g) {
      // Cursor feedback over the active text layer's box and handles.
      let hc: string | null = null
      if (active?.type === 'text' && active.visible && TEXT_HANDLE_TOOLS.includes(tool)) {
        const b = S.layerBounds(active)
        const r = vpRef.current!.getBoundingClientRect()
        const hit = handlePoints(b, view).find(([hx, hy]) => Math.abs(e.clientX - r.left - hx) <= 7 && Math.abs(e.clientY - r.top - hy) <= 7)
        if (hit) hc = hit[2] === 'tl' || hit[2] === 'br' ? 'nwse-resize' : 'nesw-resize'
        else if (S.inRect(b, x, y)) hc = 'move'
      }
      if (hc !== hoverCursor) setHoverCursor(hc)
      return
    }
    if (e.buttons === 0 && e.pointerType === 'mouse') return onPointerUp()
    switch (g.kind) {
      case 'pan':
        setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy }))
        return
      case 'paint': {
        let lx = x - g.layer.x
        let ly = y - g.layer.y
        if (e.shiftKey) {
          // Hold Shift to lock the stroke to the axis you move along first.
          g.lock ??= { x: g.lx, y: g.ly, axis: null }
          if (!g.lock.axis && Math.max(Math.abs(lx - g.lock.x), Math.abs(ly - g.lock.y)) >= 2)
            g.lock.axis = Math.abs(lx - g.lock.x) >= Math.abs(ly - g.lock.y) ? 'h' : 'v'
          if (!g.lock.axis) return
          if (g.lock.axis === 'h') ly = g.lock.y
          else lx = g.lock.x
        } else g.lock = null
        if (lx === g.lx && ly === g.ly) return
        S.linePoints(g.lx, g.ly, lx, ly, (px, py) => S.stamp(g.r, px, py, opts.size, opts.shape, g.paint, g.layer.x, g.layer.y))
        g.lx = lx
        g.ly = ly
        lastPoint.current = { x: lx + g.layer.x, y: ly + g.layer.y }
        draw()
        return
      }
      case 'textResize': {
        const r = vpRef.current!.getBoundingClientRect()
        const fx = (e.clientX - r.left - view.x) / view.scale
        const fy = (e.clientY - r.top - view.y) / view.scale
        preview.current = { patch: new Map([[g.layer.id, resizedText(g.layer, g.b, g.corner, fx, fy)]]) }
        draw()
        return
      }
      case 'shape':
      case 'gradient': {
        let x1 = x
        let y1 = y
        if (e.shiftKey && g.kind === 'shape') {
          if (tool === 'line') {
            // Snap to 0 / 45 / 90 degrees.
            const dx = x - g.x0
            const dy = y - g.y0
            if (Math.abs(dx) > 2 * Math.abs(dy)) y1 = g.y0
            else if (Math.abs(dy) > 2 * Math.abs(dx)) x1 = g.x0
            else {
              const d = Math.max(Math.abs(dx), Math.abs(dy))
              x1 = g.x0 + Math.sign(dx) * d
              y1 = g.y0 + Math.sign(dy) * d
            }
          } else {
            const d = Math.max(Math.abs(x - g.x0), Math.abs(y - g.y0))
            x1 = g.x0 + Math.sign(x - g.x0 || 1) * d
            y1 = g.y0 + Math.sign(y - g.y0 || 1) * d
          }
        }
        if (x1 === g.x1 && y1 === g.y1) return
        g.x1 = x1
        g.y1 = y1
        updateShape()
        return
      }
      case 'select':
        preview.current = { sel: S.normRect(g.x0, g.y0, x, y) }
        draw()
        return
      case 'float': {
        g.dx = x - g.sx
        g.dy = y - g.sy
        const r = S.cloneRaster(g.base)
        S.pasteClip(g.layer, r, g.clip, g.clip.x + g.dx, g.clip.y + g.dy)
        preview.current = { overrides: new Map([[g.layer.id, r]]), sel: { x: g.clip.x + g.dx, y: g.clip.y + g.dy, w: g.clip.w, h: g.clip.h } }
        draw()
        return
      }
      case 'moveLayer': {
        const dx = x - g.sx
        const dy = y - g.sy
        if (!g.moved && !dx && !dy) return
        g.moved = true
        preview.current = { patch: new Map([[g.id, { x: g.ox + dx, y: g.oy + dy }]]) }
        draw()
        return
      }
    }
  }

  const onPointerUp = () => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    const p = preview.current
    preview.current = {}
    switch (g.kind) {
      case 'paint':
        finishRaster(g.layer, g.r)
        break
      case 'shape':
      case 'gradient':
        finishRaster(g.layer, p.overrides?.get(g.layer.id) ?? shapePreview(g))
        break
      case 'select': {
        const s = p.sel
        setSel(s && s.w > 1 && s.h > 1 ? s : null)
        break
      }
      case 'float': {
        const r = S.cloneRaster(g.base)
        S.pasteClip(g.layer, r, g.clip, g.clip.x + g.dx, g.clip.y + g.dy)
        if (g.dx || g.dy) saveLayers(frame.layers.map((l) => (l.id === g.layer.id ? S.withRaster(g.layer, r) : l)))
        setSel({ x: g.clip.x + g.dx, y: g.clip.y + g.dy, w: g.clip.w, h: g.clip.h })
        break
      }
      case 'moveLayer': {
        const pos = p.patch?.get(g.id)
        if (g.moved && pos) updateLayer(g.id, pos)
        break
      }
      case 'textResize': {
        const pt = p.patch?.get(g.layer.id)
        if (pt && (pt.size !== g.layer.size || pt.x !== g.layer.x || pt.y !== g.layer.y)) updateLayer(g.layer.id, pt)
        break
      }
    }
    draw()
  }

  // ---- clipboard / keyboard ----------------------------------------------

  const copy = () => {
    if (!active) return
    if (active.type === 'text' && !sel) {
      clipboard = { kind: 'layer', layer: active }
      return
    }
    const layer = active.type === 'raster' ? active : S.rasterize(active)
    const area = sel ?? S.layerBounds(layer)
    if (!area.w || !area.h) return
    clipboard = { kind: 'pixels', clip: S.copyRect(layer, S.rasterOf(layer), area) }
  }

  const clearSelection = () => {
    if (!sel || active?.type !== 'raster') return
    const r = S.rasterOf(active)
    S.clearRect(active, r, sel)
    saveLayers(frame.layers.map((l) => (l.id === active.id ? S.withRaster(active, r) : l)))
  }

  const deleteActiveLayer = () => {
    if (!active || frame.layers.length <= 1) return
    saveLayers(frame.layers.filter((l) => l.id !== active.id))
    setActiveId(null)
  }

  const paste = () => {
    const c = clipboard
    if (!c) return
    const idx = active ? frame.layers.indexOf(active) + 1 : frame.layers.length
    let layer: ScreenLayer
    if (c.kind === 'layer') {
      layer = { ...c.layer, id: uid(), x: c.layer.x + 4, y: c.layer.y + 4, name: c.layer.name + ' copy' }
      clipboard = { kind: 'layer', layer }
    } else {
      const l = S.newRasterLayer('Pasted')
      const r = S.emptyRaster()
      S.pasteClip(l, r, c.clip, c.clip.x, c.clip.y)
      layer = S.withRaster(l, r)
      setSel({ x: c.clip.x, y: c.clip.y, w: c.clip.w, h: c.clip.h })
      setTool('select')
    }
    saveLayers([...frame.layers.slice(0, idx), layer, ...frame.layers.slice(idx)])
    setActiveId(layer.id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t?.closest?.('input, textarea, select')
      if (e.type === 'keyup') {
        if (e.code === 'Space') setSpaceHeld(false)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (typing) return t!.blur()
        if (gesture.current) return
        if (sel) return setSel(null)
        return close()
      }
      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        setSpaceHeld(true)
        return
      }
      if (typing) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const st = useStore.getState()
      if (mod) {
        if (k === 'z') return (e.preventDefault(), e.shiftKey ? st.redo() : st.undo())
        if (k === 'y') return (e.preventDefault(), st.redo())
        if (k === 'c') return (e.preventDefault(), copy())
        if (k === 'x') return (e.preventDefault(), copy(), sel ? clearSelection() : deleteActiveLayer())
        if (k === 'v') return (e.preventDefault(), paste())
        if (k === 'a') return (e.preventDefault(), setSel({ x: 0, y: 0, w: S.W, h: S.H }), setTool('select'))
        if (k === 'd') return (e.preventDefault(), setSel(null))
        if (k === '0') return (e.preventDefault(), fit())
        if (k === '=' || k === '+') return (e.preventDefault(), zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25))
        if (k === '-') return (e.preventDefault(), zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.8))
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') return (e.preventDefault(), sel ? clearSelection() : deleteActiveLayer())
      if (e.key.startsWith('Arrow') && active) {
        e.preventDefault()
        const step = e.shiftKey ? 8 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        if (!layout?.screenFrames) return updateLayer(active.id, { x: active.x + dx, y: active.y + dy })
        // Read the stored layer so fast key repeats accumulate.
        return commit((d) => {
          const l = findScreenHost(d, layoutId)
          const f = l?.screenFrames?.[fi]
          const ly = f?.layers.find((x) => x.id === active.id)
          if (!l || !f || !ly) return
          ly.x += dx
          ly.y += dy
          f.image = S.flatten(f.layers as ScreenLayer[])
          l.screen = l.screenFrames![0].image
        }, `nudge-${active.id}`)
      }
      if (e.shiftKey && e.code === 'Digit1') return fit()
      const toolHit = TOOLS.find((x) => x.key.toLowerCase() === k)
      if (toolHit && !e.shiftKey) return setTool(toolHit.id)
      if (k === 'x') return setOpts((o) => ({ ...o, ink: o.ink ? 0 : 1 }))
      if (k === '[' || e.code === 'BracketLeft') return setOpts((o) => ({ ...o, size: Math.max(1, o.size - 1) }))
      if (k === ']' || e.code === 'BracketRight') return setOpts((o) => ({ ...o, size: Math.min(16, o.size + 1) }))
      if (k === 'f') return setOpts((o) => ({ ...o, fill: !o.fill }))
      if (k === 'p') {
        const i = S.PATTERNS.findIndex((p) => p.id === opts.pattern)
        const n = S.PATTERNS.length
        return setOpts((o) => ({ ...o, pattern: S.PATTERNS[(i + (e.shiftKey ? n - 1 : 1)) % n].id }))
      }
      if (k === '#') return setGrid((g) => !g)
      if (k === ',') return setFrameIdx(Math.max(0, fi - 1))
      if (k === '.') return setFrameIdx(Math.min(frames.length - 1, fi + 1))
      if (k === 'enter' && frames.length > 1) return setPlaying((p) => !p)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  })

  if (!layout) return null
  const cursorStyle = gesture.current?.kind === 'pan' ? 'grabbing' : spaceHeld ? 'grab' : hoverCursor ? hoverCursor : tool === 'move' ? 'move' : tool === 'text' ? 'text' : 'crosshair'

  return (
    <div className="modal-backdrop">
      <div className="modal screen-editor2" onContextMenu={(e) => e.preventDefault()}>
        <header>
          <h2>{layout.type === 'screen' ? layout.name || 'Screen' : `Screen · ${layout.name}`}</h2>
          <span className="muted small">
            128 × 64 · {cursor && cursor.x >= 0 && cursor.y >= 0 && cursor.x < S.W && cursor.y < S.H ? `x ${cursor.x}, y ${cursor.y}` : 'right-click / Alt draws the other colour'}
          </span>
          <span className="spacer" />
          <button className={grid ? 'btn small on' : 'btn small'} onClick={() => setGrid(!grid)} title="Pixel grid (#)">
            Grid
          </button>
          <button className="btn small" onClick={fit} title="Fit (Shift+1)">
            {Math.round(view.scale * 100)}%
          </button>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </header>
        <div className="se-body">
          <div className="se-tools">
            {TOOLS.map((t) => (
              <button key={t.id} className={tool === t.id ? 'se-tool on' : 'se-tool'} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
                <span>{t.icon}</span>
              </button>
            ))}
            <div className="se-sep" />
            <button
              className="se-ink"
              title="Ink colour (X swaps)"
              onClick={() => setOpts((o) => ({ ...o, ink: o.ink ? 0 : 1 }))}
              style={{ background: opts.ink ? '#fff' : '#000' }}
            />
          </div>
          <div
            ref={vpRef}
            className="se-viewport"
            style={{ cursor: cursorStyle }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onLostPointerCapture={onPointerUp}
            onPointerLeave={() => setCursor(null)}
            onDoubleClick={(e) => {
              const { x, y } = toPixel(e.clientX, e.clientY)
              const hit = layerAt(x, y)
              if (hit?.type === 'text') {
                setActiveId(hit.id)
                setFocusText((n) => n + 1)
              }
            }}
          >
            <canvas ref={canvasRef} />
          </div>
          <SidePanel
            tool={tool}
            opts={opts}
            setOpts={setOpts}
            layers={frame.layers}
            active={active}
            setActiveId={setActiveId}
            saveLayers={saveLayers}
            updateLayer={updateLayer}
            focusText={focusText}
            sel={sel}
          />
        </div>
        <FramesStrip
          frames={frames}
          index={fi}
          setIndex={(i) => {
            setPlaying(false)
            setFrameIdx(i)
          }}
          saveFrames={saveFrames}
          playing={playing}
          setPlaying={setPlaying}
          onion={onion}
          setOnion={setOnion}
          setDuration={(ms) => {
            const fs = frames.map((f, i) => (i === fi ? { ...f, duration: ms } : f))
            saveFrames(fs)
          }}
        />
        <footer className="se-footer muted small">
          M select · V move · B brush · E eraser · L line · R rect · O ellipse · G fill · D gradient · T text · X swap colour · [ ] size · P pattern · F fill on/off ·
          Shift-click brush draws a line · wheel zoom · middle/Space-drag pan · {MOD}+C/X/V/A/D · , . frames · Enter play
        </footer>
      </div>
    </div>
  )
}
