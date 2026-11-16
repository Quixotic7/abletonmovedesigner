import { useEffect, useMemo, useRef, useState } from 'react'
import { uid, type RasterLayer, type ScreenLayer, type TextLayer } from '../../model/types'
import * as S from '../../lib/screen'
import type { Tool, ToolOpts } from './ScreenEditor'

interface Props {
  tool: Tool
  opts: ToolOpts
  setOpts: (fn: (o: ToolOpts) => ToolOpts) => void
  layers: ScreenLayer[]
  active: ScreenLayer | undefined
  setActiveId: (id: string | null) => void
  saveLayers: (layers: ScreenLayer[], key?: string) => void
  updateLayer: (id: string, patch: Partial<TextLayer> | Partial<RasterLayer>, key?: string) => void
  focusText: number
  sel: S.Rect | null
}

/** Small preview images for the dither patterns. */
function usePatternIcons() {
  return useMemo(() => {
    const out: Record<string, string> = {}
    const c = document.createElement('canvas')
    c.width = 16
    c.height = 16
    const ctx = c.getContext('2d')!
    for (const p of S.PATTERNS) {
      const img = ctx.createImageData(16, 16)
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const v = p.on(x, y) ? 255 : 0
          const i = (y * 16 + x) * 4
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v
          img.data[i + 3] = 255
        }
      ctx.putImageData(img, 0, 0)
      out[p.id] = c.toDataURL()
    }
    return out
  }, [])
}

export function SidePanel(p: Props) {
  const { tool, opts, setOpts, layers, active } = p
  const icons = usePatternIcons()
  const set = <K extends keyof ToolOpts>(k: K, v: ToolOpts[K]) => setOpts((o) => ({ ...o, [k]: v }))
  const brushy = ['brush', 'eraser', 'line', 'rect', 'ellipse'].includes(tool)
  const patterned = ['brush', 'line', 'rect', 'ellipse', 'fill'].includes(tool)

  return (
    <aside className="se-side" onPointerDown={(e) => e.stopPropagation()}>
      <section>
        <h4>Tool</h4>
        {tool !== 'eraser' && tool !== 'move' && tool !== 'select' && (
          <div className="row">
            <button className={opts.ink ? 'btn small on' : 'btn small'} onClick={() => set('ink', 1)} title="Draw white">
              <span className="swatch" style={{ background: '#fff' }} /> White
            </button>
            <button className={!opts.ink ? 'btn small on' : 'btn small'} onClick={() => set('ink', 0)} title="Draw black">
              <span className="swatch" style={{ background: '#000' }} /> Black
            </button>
            <span className="muted small">X swaps</span>
          </div>
        )}
        {(tool === 'brush' || tool === 'eraser') && <p className="muted small">Hold Shift while drawing to lock to one axis. Shift-click draws a line from the last point.</p>}
        {brushy && (
          <>
            <label className="se-field">
              Size {opts.size}px
              <input type="range" min={1} max={16} value={opts.size} onChange={(e) => set('size', +e.target.value)} />
            </label>
            <div className="row">
              {(['round', 'square', 'spray'] as const).map((sh) => (
                <button key={sh} className={opts.shape === sh ? 'btn small on' : 'btn small'} onClick={() => set('shape', sh)}>
                  {sh}
                </button>
              ))}
            </div>
          </>
        )}
        {(tool === 'rect' || tool === 'ellipse') && (
          <label className="check">
            <input type="checkbox" checked={opts.filled} onChange={(e) => set('filled', e.target.checked)} /> Filled (F)
          </label>
        )}
        {tool === 'fill' && (
          <>
            <div className="row">
              <button className={opts.fillMode === 'area' ? 'btn small on' : 'btn small'} onClick={() => set('fillMode', 'area')} title="Fill the connected area you click">
                Fill area
              </button>
              <button className={opts.fillMode === 'selection' ? 'btn small on' : 'btn small'} onClick={() => set('fillMode', 'selection')} title="Fill the whole selection (or the whole screen)">
                Fill selection
              </button>
            </div>
            <p className="muted small">Shift-click does the other one.</p>
          </>
        )}
        {patterned && (
          <>
            <h4>Dither (P)</h4>
            <div className="se-patterns">
              {S.PATTERNS.map((pt) => (
                <button key={pt.id} className={opts.pattern === pt.id ? 'se-pat on' : 'se-pat'} onClick={() => set('pattern', pt.id)} title={pt.name}>
                  <img src={icons[pt.id]} alt={pt.name} />
                </button>
              ))}
            </div>
            <label className="check" title="Off: the gaps in a dither take the other colour, covering what's underneath">
              <input type="checkbox" checked={!opts.opaque} onChange={(e) => set('opaque', !e.target.checked)} /> Transparent gaps
            </label>
          </>
        )}
        {tool === 'gradient' && (
          <>
            <label className="check">
              <input type="checkbox" checked={opts.radial} onChange={(e) => set('radial', e.target.checked)} /> Radial
            </label>
            <p className="muted small">Drag from the {opts.ink ? 'white' : 'black'} end to the other. Fills the selection, or the whole layer.</p>
          </>
        )}
        {tool === 'select' && <p className="muted small">Drag a box. Drag inside it to move those pixels. Brushes and fills stay inside the box.</p>}
        {tool === 'move' && <p className="muted small">Drag to move a layer (picks the layer under the cursor). Arrow keys nudge. Text: drag a corner to resize.</p>}
        {tool === 'text' && <p className="muted small">Click to add a text layer. Drag a text box to move it; drag a corner to change the font size.</p>}
        {p.sel && (
          <p className="se-sel-note small">
            Selection {p.sel.w}×{p.sel.h} at {p.sel.x},{p.sel.y}. Painting, fills and gradients stay inside it. Esc or {'⌘'}/Ctrl+D clears it.
          </p>
        )}
      </section>

      {active?.type === 'text' && <TextProps layer={active} update={p.updateLayer} focus={p.focusText} onRasterize={() => p.saveLayers(layers.map((l) => (l.id === active.id ? S.rasterize(l) : l)))} />}

      <LayersSection {...p} />
    </aside>
  )
}

function TextProps({ layer, update, focus, onRasterize }: { layer: TextLayer; update: Props['updateLayer']; focus: number; onRasterize: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (focus) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [focus])
  const def = S.fontDef(layer.font)
  const key = `text-${layer.id}`
  return (
    <section>
      <h4>Text</h4>
      <textarea
        ref={ref}
        className="se-textarea"
        rows={2}
        value={layer.text}
        onChange={(e) => update(layer.id, { text: e.target.value, name: e.target.value.split('\n')[0].slice(0, 24) || 'Text' }, key)}
      />
      <div className="se-grid2">
        <label className="se-field">
          Font
          <select
            value={layer.font}
            onChange={(e) => {
              const nd = S.fontDef(e.target.value)
              update(layer.id, { font: e.target.value, size: nd.native ? nd.native * Math.max(1, Math.round(layer.size / (def.native || nd.native))) : Math.max(8, layer.size) })
            }}
          >
            {S.FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="se-field">
          Size
          {def.native ? (
            <select value={layer.size} onChange={(e) => update(layer.id, { size: +e.target.value })}>
              {[1, 2, 3, 4, 5, 6].map((k) => (
                <option key={k} value={def.native * k}>
                  {def.native * k}px ({k}×)
                </option>
              ))}
            </select>
          ) : (
            <input type="number" min={5} max={64} value={layer.size} onChange={(e) => update(layer.id, { size: Math.max(5, Math.min(64, +e.target.value || 8)) }, key + '-size')} />
          )}
        </label>
        <label className="se-field">
          X
          <input type="number" value={layer.x} onChange={(e) => update(layer.id, { x: Math.round(+e.target.value) }, key + '-x')} />
        </label>
        <label className="se-field">
          Y
          <input type="number" value={layer.y} onChange={(e) => update(layer.id, { y: Math.round(+e.target.value) }, key + '-y')} />
        </label>
      </div>
      <div className="row wrap">
        <label className="check">
          <input type="checkbox" checked={layer.bold} onChange={(e) => update(layer.id, { bold: e.target.checked })} /> Bold
        </label>
        <label className="check">
          <input type="checkbox" checked={!layer.ink} onChange={(e) => update(layer.id, { ink: e.target.checked ? 0 : 1 })} /> Black text
        </label>
        <label className="check">
          <input type="checkbox" checked={layer.box} onChange={(e) => update(layer.id, { box: e.target.checked })} /> Box behind
        </label>
      </div>
      <button className="btn small wide" onClick={onRasterize} title="Turn this text into pixels you can paint on">
        Convert to raster
      </button>
    </section>
  )
}

function LayersSection({ layers, active, setActiveId, saveLayers, updateLayer }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const idx = active ? layers.indexOf(active) : -1
  const move = (d: number) => {
    if (idx < 0) return
    const j = idx + d
    if (j < 0 || j >= layers.length) return
    const out = [...layers]
    ;[out[idx], out[j]] = [out[j], out[idx]]
    saveLayers(out)
  }
  const insert = (l: ScreenLayer) => {
    const at = idx >= 0 ? idx + 1 : layers.length
    saveLayers([...layers.slice(0, at), l, ...layers.slice(at)])
    setActiveId(l.id)
  }
  return (
    <section className="se-layers">
      <h4>Layers</h4>
      <div className="se-layer-list">
        {[...layers].reverse().map((l) => (
          <div key={l.id} className={l.id === active?.id ? 'se-layer on' : 'se-layer'} onClick={() => setActiveId(l.id)}>
            <button
              className="se-eye"
              title={l.visible ? 'Hide' : 'Show'}
              onClick={(e) => {
                e.stopPropagation()
                updateLayer(l.id, { visible: !l.visible })
              }}
            >
              {l.visible ? '●' : '○'}
            </button>
            <span className="se-kind">{l.type === 'text' ? 'T' : '▦'}</span>
            {renaming === l.id ? (
              <input
                autoFocus
                defaultValue={l.name}
                onBlur={(e) => {
                  if (e.target.value !== l.name) updateLayer(l.id, { name: e.target.value })
                  setRenaming(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                  e.stopPropagation()
                }}
              />
            ) : (
              <span className="se-name" onDoubleClick={() => setRenaming(l.id)} title="Double-click to rename">
                {l.name}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="row wrap">
        <button className="btn small" onClick={() => insert(S.newRasterLayer(`Layer ${layers.length + 1}`))} title="New raster layer">
          + Layer
        </button>
        <button className="btn small" onClick={() => insert(S.newTextLayer(4, 4))} title="New text layer">
          + Text
        </button>
        <button className="btn small" disabled={!active} onClick={() => active && insert({ ...active, id: uid(), name: active.name + ' copy' })} title="Duplicate layer">
          Dup
        </button>
        <button className="btn small" disabled={idx >= layers.length - 1} onClick={() => move(1)} title="Move up">
          ↑
        </button>
        <button className="btn small" disabled={idx <= 0} onClick={() => move(-1)} title="Move down">
          ↓
        </button>
        <button
          className="btn small"
          disabled={idx <= 0}
          title="Merge into the layer below"
          onClick={() => {
            if (idx <= 0 || !active) return
            const merged = S.mergeDown(layers[idx - 1], active)
            saveLayers([...layers.slice(0, idx - 1), merged, ...layers.slice(idx + 1)])
            setActiveId(merged.id)
          }}
        >
          Merge ↓
        </button>
        <button
          className="btn small"
          disabled={layers.length <= 1}
          title="Flatten all layers into one"
          onClick={() => {
            const flat = S.newRasterLayer('Flattened')
            const px = S.composite(layers)
            const out = S.withRaster(flat, { data: px, alpha: new Uint8Array(S.N).fill(1) })
            saveLayers([out])
            setActiveId(out.id)
          }}
        >
          Flatten
        </button>
        <button
          className="btn small"
          disabled={!active || layers.length <= 1}
          onClick={() => {
            if (!active) return
            saveLayers(layers.filter((l) => l.id !== active.id))
            setActiveId(null)
          }}
          title="Delete layer"
        >
          Delete
        </button>
      </div>
    </section>
  )
}
