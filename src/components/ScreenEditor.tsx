import { useEffect, useRef, useState } from 'react'
import { useStore, findLayout } from '../store'
import * as bm from '../lib/bitmap'
import { MOD } from '../shortcuts'

type Tool = 'pencil' | 'eraser' | 'line' | 'rect' | 'frect' | 'fill' | 'text'

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'pencil', label: 'Pencil', key: 'p' },
  { id: 'eraser', label: 'Eraser', key: 'e' },
  { id: 'line', label: 'Line', key: 'l' },
  { id: 'rect', label: 'Rect', key: 'r' },
  { id: 'frect', label: 'Filled rect', key: 'f' },
  { id: 'fill', label: 'Fill', key: 'g' },
  { id: 'text', label: 'Text', key: 't' },
]

const W = bm.SCREEN_W
const H = bm.SCREEN_H

export function ScreenEditor({ layoutId }: { layoutId: string }) {
  const layout = useStore((s) => findLayout(s.doc, layoutId))
  const screen = layout?.screen ?? bm.emptyScreen()
  const commit = useStore((s) => s.commit)
  const close = () => useStore.getState().set({ dialog: null })

  const [tool, setTool] = useState<Tool>('pencil')
  const [zoom, setZoom] = useState(6)
  const [grid, setGrid] = useState(true)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [textPos, setTextPos] = useState<{ x: number; y: number } | null>(null)
  const [textValue, setTextValue] = useState('')
  const [textInk, setTextInk] = useState(1)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixels = useRef<bm.Pixels>(bm.decode(screen))
  const preview = useRef<bm.Pixels | null>(null)
  const drag = useRef<{ x0: number; y0: number; lx: number; ly: number; v: number } | null>(null)
  const textInput = useRef<HTMLInputElement>(null)

  // Re-sync when the stored screen changes (undo/redo while open).
  useEffect(() => {
    if (!drag.current) {
      pixels.current = bm.decode(screen)
      draw()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, zoom, grid])

  useEffect(() => {
    if (tool !== 'text') setTextPos(null)
  }, [tool])

  useEffect(() => {
    drawWithText()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textPos, textValue, textInk])

  function drawWithText() {
    if (textPos && textValue) {
      const p = pixels.current.slice()
      bm.text(p, textPos.x, textPos.y, textValue, textInk)
      preview.current = p
    } else if (!drag.current) preview.current = null
    draw()
  }

  function draw() {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    c.width = W * zoom
    c.height = H * zoom
    const px = preview.current ?? pixels.current
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#fff'
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[y * W + x]) ctx.fillRect(x * zoom, y * zoom, zoom, zoom)
    if (grid && zoom >= 4) {
      ctx.strokeStyle = 'rgba(120,140,170,0.22)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 1; x < W; x++) {
        ctx.moveTo(x * zoom + 0.5, 0)
        ctx.lineTo(x * zoom + 0.5, c.height)
      }
      for (let y = 1; y < H; y++) {
        ctx.moveTo(0, y * zoom + 0.5)
        ctx.lineTo(c.width, y * zoom + 0.5)
      }
      ctx.stroke()
      ctx.strokeStyle = 'rgba(120,160,255,0.45)'
      ctx.beginPath()
      for (let x = 8; x < W; x += 8) {
        ctx.moveTo(x * zoom + 0.5, 0)
        ctx.lineTo(x * zoom + 0.5, c.height)
      }
      for (let y = 8; y < H; y += 8) {
        ctx.moveTo(0, y * zoom + 0.5)
        ctx.lineTo(c.width, y * zoom + 0.5)
      }
      ctx.stroke()
    }
    if (textPos) {
      ctx.strokeStyle = '#ff8a3d'
      ctx.strokeRect(textPos.x * zoom + 0.5, textPos.y * zoom + 0.5, Math.max(1, bm.textWidth(textValue || ' ')) * zoom, 8 * zoom)
    }
  }

  const save = (px: bm.Pixels) => {
    const enc = bm.encode(px)
    if (enc === screen) return
    commit((d) => {
      const l = findLayout(d, layoutId)
      if (l) l.screen = enc
    })
  }

  const toPixel = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: Math.floor(((e.clientX - r.left) / r.width) * W), y: Math.floor(((e.clientY - r.top) / r.height) * H) }
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return
    e.preventDefault()
    const { x, y } = toPixel(e)
    // Right button / Alt draws in black.
    const v = tool === 'eraser' || e.button === 2 || e.altKey ? 0 : 1
    if (tool === 'text') {
      commitText()
      setTextPos({ x, y })
      setTextInk(v)
      setTimeout(() => textInput.current?.focus(), 0)
      return
    }
    if (tool === 'fill') {
      const p = pixels.current.slice()
      bm.fill(p, x, y, v)
      pixels.current = p
      draw()
      save(p)
      return
    }
    canvasRef.current!.setPointerCapture(e.pointerId)
    drag.current = { x0: x, y0: y, lx: x, ly: y, v }
    if (tool === 'pencil' || tool === 'eraser') {
      bm.set(pixels.current, x, y, v)
      draw()
    } else {
      onMove(e)
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const { x, y } = toPixel(e)
    setCursor(x >= 0 && y >= 0 && x < W && y < H ? { x, y } : null)
    const d = drag.current
    if (!d) return
    if (tool === 'pencil' || tool === 'eraser') {
      bm.line(pixels.current, d.lx, d.ly, x, y, d.v)
      d.lx = x
      d.ly = y
      draw()
    } else {
      const p = pixels.current.slice()
      if (tool === 'line') bm.line(p, d.x0, d.y0, x, y, d.v)
      else bm.rect(p, d.x0, d.y0, x, y, d.v, tool === 'frect')
      preview.current = p
      draw()
    }
  }

  const onUp = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (preview.current) {
      pixels.current = preview.current
      preview.current = null
    }
    draw()
    save(pixels.current)
  }

  function commitText() {
    if (textPos && textValue) {
      const p = pixels.current.slice()
      bm.text(p, textPos.x, textPos.y, textValue, textInk)
      pixels.current = p
      save(p)
    }
    preview.current = null
    setTextValue('')
    setTextPos(null)
  }

  const whole = (fn: (p: bm.Pixels) => void) => {
    const p = pixels.current.slice()
    fn(p)
    pixels.current = p
    draw()
    save(p)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inText = (e.target as HTMLElement).tagName === 'INPUT'
      if (e.key === 'Escape') {
        e.preventDefault()
        if (textPos) {
          setTextPos(null)
          setTextValue('')
          preview.current = null
          draw()
        } else close()
        return
      }
      if (inText) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        const s = useStore.getState()
        e.shiftKey ? s.redo() : s.undo()
        return
      }
      if (mod) return
      const t = TOOLS.find((t) => t.key === e.key.toLowerCase())
      if (t) setTool(t.id)
      if (e.key === '#') setGrid((g) => !g)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!layout) return null

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && (commitText(), close())}>
      <div className="modal screen-editor">
        <header>
          <h2>Screen · {layout.name}</h2>
          <span className="muted">128 × 64, 1-bit · {cursor ? `x ${cursor.x}, y ${cursor.y}` : 'left = white, right/Alt = black'}</span>
        </header>
        <div className="screen-tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'btn small on' : 'btn small'} onClick={() => setTool(t.id)} title={`${t.label} (${t.key.toUpperCase()})`}>
              {t.label}
            </button>
          ))}
          <span className="sep" />
          <button className="btn small" onClick={() => whole((p) => p.forEach((v, i) => (p[i] = v ? 0 : 1)))}>
            Invert
          </button>
          <button className="btn small" onClick={() => whole((p) => p.fill(0))}>
            Clear
          </button>
          <span className="sep" />
          <button className={grid ? 'btn small on' : 'btn small'} onClick={() => setGrid(!grid)} title="Pixel grid (#)">
            Grid
          </button>
          <select value={zoom} onChange={(e) => setZoom(+e.target.value)} title="Zoom">
            {[3, 4, 5, 6, 7, 8].map((z) => (
              <option key={z} value={z}>
                {z}×
              </option>
            ))}
          </select>
        </div>
        {(
          <div className="screen-text" style={{ visibility: tool === 'text' ? 'visible' : 'hidden' }}>
            <input
              ref={textInput}
              value={textValue}
              placeholder={textPos ? 'Type, Enter to place' : 'Click on the screen to place text'}
              disabled={!textPos}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitText()
                }
              }}
            />
            <span className="muted small">5×7 font, 6 px per character</span>
          </div>
        )}
        <div className="screen-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="screen-canvas"
            style={{ width: W * zoom, height: H * zoom, cursor: 'crosshair' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => setCursor(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
          <div className="screen-actual">
            <span className="muted small">Actual size</span>
            <img src={bm.screenDataUrl(screen)} width={128} height={64} alt="" />
          </div>
        </div>
        <footer>
          <span className="muted small">Every stroke is one undo step ({MOD}+Z). Stored as 1024 bytes, row-major, MSB = left pixel.</span>
          <button
            className="btn primary"
            onClick={() => {
              commitText()
              close()
            }}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
