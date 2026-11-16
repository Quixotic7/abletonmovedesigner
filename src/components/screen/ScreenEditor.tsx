import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, findLayout } from '../../store'
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
  filled: boolean
  radial: boolean
}

type Clipboard = { kind: 'pixels'; clip: S.Clip } | { kind: 'layer'; layer: ScreenLayer }
/** Shared across editor sessions and layouts, so you can copy between frames and layouts. */
let clipboard: Clipboard | null = null

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'paint'; layer: RasterLayer; r: S.Raster; paint: S.Paint; lx: number; ly: number }
  | { kind: 'shape'; layer: RasterLayer; base: S.Raster; paint: S.Paint; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'gradient'; layer: RasterLayer; base: S.Raster; ink: 0 | 1; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'select'; x0: number; y0: number }
  | { kind: 'float'; layer: RasterLayer; base: S.Raster; clip: S.Clip; sx: number; sy: number; dx: number; dy: number }
  | { kind: 'moveLayer'; id: string; ox: number; oy: number; sx: number; sy: number; moved: boolean }

interface View {
  x: number
  y: number
  scale: number
}

export function ScreenEditor({ layoutId }: { layoutId: string }) {
  const layout = useStore((s) => findLayout(s.doc, layoutId))
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
  const [opts, setOpts] = useState<ToolOpts>({ ink: 1, pattern: 'solid', size: 1, shape: 'round', filled: false, radial: false })
  const [sel, setSel] = useState<S.Rect | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 6 })
  const [playing, setPlaying] = useState(false)
  const [onion, setOnion] = useState(false)
  const [grid, setGrid] = useState(true)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [focusText, setFocusText] = useState(0)

  const vpRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const preview = useRef<{ overrides?: Map<string, S.Raster>; layerPos?: Map<string, { x: number; y: number }>; sel?: S.Rect | null }>({})
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const fitted = useRef(false)

  // ---- persistence -------------------------------------------------------

  /** Replace one frame's layers (one undo step, or merged with `key` while typing). */
  const saveLayers = useCallback(
    (layers: ScreenLayer[], key?: string, idx = fi) => {
      commit((d) => {
        const l = findLayout(d, layoutId)
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
        const l = findLayout(d, layoutId)
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
    if (p.layerPos) layers = layers.map((l) => (p.layerPos!.has(l.id) ? { ...l, ...p.layerPos!.get(l.id)! } : l))
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
      const pos = p.layerPos?.get(active.id)
      const b = S.layerBounds(pos ? ({ ...active, ...pos } as ScreenLayer) : active)
      if (b.w && b.h) rectOut(b, '#ff8a3d', [4, 3])
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
    const paint: S.Paint = { ink: tool === 'eraser' ? -1 : ink, pattern: tool === 'eraser' ? S.PATTERNS[0] : pattern, clip: sel }
    const base = S.rasterOf(layer)
    if (tool === 'fill') {
      S.floodFill(base, lx, ly, paint, layer.x, layer.y)
      finishRaster(layer, base)
      return
    }
    if (tool === 'brush' || tool === 'eraser') {
      const last = lastPoint.current
      if (e.shiftKey && last) S.linePoints(last.x - layer.x, last.y - layer.y, lx, ly, (px, py) => S.stamp(base, px, py, opts.size, opts.shape, paint, layer.x, layer.y))
      else S.stamp(base, lx, ly, opts.size, opts.shape, paint, layer.x, layer.y)
      gesture.current = { kind: 'paint', layer, r: base, paint, lx, ly }
      preview.current = { overrides: new Map([[layer.id, base]]) }
      lastPoint.current = { x, y }
      draw()
      return
    }
    if (tool === 'gradient') {
      gesture.current = { kind: 'gradient', layer, base, ink, x0: x, y0: y, x1: x, y1: y }
      return
    }
    gesture.current = { kind: 'shape', layer, base, paint, x0: x, y0: y, x1: x, y1: y }
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
    const plotAt = (x: number, y: number) => S.plot(r, x - layer.x, y - layer.y, g.paint, layer.x, layer.y)
    if (tool === 'line') S.linePoints(g.x0, g.y0, g.x1, g.y1, stampAt)
    else if (tool === 'rect') S.rectShape(g.x0, g.y0, g.x1, g.y1, opts.filled, opts.filled ? plotAt : stampAt)
    else if (tool === 'ellipse') S.ellipseShape(g.x0, g.y0, g.x1, g.y1, opts.filled, opts.filled ? plotAt : stampAt)
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
    if (!g) return
    if (e.buttons === 0 && e.pointerType === 'mouse') return onPointerUp()
    switch (g.kind) {
      case 'pan':
        setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy }))
        return
      case 'paint': {
        const lx = x - g.layer.x
        const ly = y - g.layer.y
        if (lx === g.lx && ly === g.ly) return
        S.linePoints(g.lx, g.ly, lx, ly, (px, py) => S.stamp(g.r, px, py, opts.size, opts.shape, g.paint, g.layer.x, g.layer.y))
        g.lx = lx
        g.ly = ly
        lastPoint.current = { x, y }
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
        preview.current = { layerPos: new Map([[g.id, { x: g.ox + dx, y: g.oy + dy }]]) }
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
        const pos = p.layerPos?.get(g.id)
        if (g.moved && pos) updateLayer(g.id, pos)
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
          const l = findLayout(d, layoutId)
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
      if (k === 'f') return setOpts((o) => ({ ...o, filled: !o.filled }))
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
  const cursorStyle = gesture.current?.kind === 'pan' ? 'grabbing' : spaceHeld ? 'grab' : tool === 'move' ? 'move' : tool === 'text' ? 'text' : 'crosshair'

  return (
    <div className="modal-backdrop">
      <div className="modal screen-editor2" onContextMenu={(e) => e.preventDefault()}>
        <header>
          <h2>Screen · {layout.name}</h2>
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
          M select · V move · B brush · E eraser · L line · R rect · O ellipse · G fill · D gradient · T text · X swap colour · [ ] size · P pattern · F filled ·
          Shift-click brush draws a line · wheel zoom · middle/Space-drag pan · {MOD}+C/X/V/A/D · , . frames · Enter play
        </footer>
      </div>
    </div>
  )
}
