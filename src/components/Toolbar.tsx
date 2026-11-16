import { useRef, useState } from 'react'
import { useStore, findLayout } from '../store'
import * as cmd from '../commands'
import { PALETTE } from '../model/ops'
import { leaveLayout, zoomCenter, zoomToFit } from '../viewport'
import { MOD } from '../shortcuts'

export function Toolbar() {
  const tool = useStore((s) => s.tool)
  const paintColor = useStore((s) => s.paintColor)
  const scale = useStore((s) => s.view.scale)
  const active = useStore((s) => findLayout(s.doc, s.activeLayoutId))
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const showLabels = useStore((s) => s.showLabels)
  const docName = useStore((s) => s.doc.name)
  const set = useStore((s) => s.set)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <div className="topbar">
        <nav className="crumbs">
          <input
            className="doc-name"
            value={docName}
            onChange={(e) => {
              const v = e.target.value
              useStore.getState().commit((d) => {
                d.name = v
              }, 'doc-name')
            }}
            title="Document name"
          />
          <span className="sep">/</span>
          {active ? (
            <>
              <button className="crumb link" onClick={leaveLayout} title="Back to the board (Esc)">
                Board
              </button>
              <span className="sep">›</span>
              <span className="crumb current">{active.name || 'Untitled layout'}</span>
              <button className="btn small" onClick={leaveLayout} title="Back to the board (Esc)">
                ← Back
              </button>
            </>
          ) : (
            <span className="crumb current">Board</span>
          )}
        </nav>

        <div className="group">
          <button className={tool === 'select' ? 'btn on' : 'btn'} onClick={() => set({ tool: 'select' })} title="Select (V)">
            ↖ Select
          </button>
          <button className={tool === 'paint' ? 'btn on' : 'btn'} onClick={() => set({ tool: tool === 'paint' ? 'select' : 'paint' })} title="Paint LEDs (B). Alt-click picks a colour.">
            <span className="swatch" style={{ background: paintColor === 'off' ? '#222' : paintColor }} /> Paint
          </button>
        </div>

        <div className="group">
          <button className="btn" onClick={cmd.addLayout} title="New layout (L)">
            + Layout
          </button>
          <button className="btn" onClick={cmd.addNote} title="New note (N)">
            + Note
          </button>
          <button className="btn" onClick={cmd.addGroup} title={`Group / frame around selection (${MOD}+G)`}>
            + Group
          </button>
        </div>

        <div className="group">
          <button className="btn" disabled={!canUndo} onClick={() => useStore.getState().undo()} title={`Undo (${MOD}+Z)`}>
            ↶
          </button>
          <button className="btn" disabled={!canRedo} onClick={() => useStore.getState().redo()} title={`Redo (${MOD}+Shift+Z)`}>
            ↷
          </button>
        </div>

        <div className="group">
          <button className="btn" onClick={() => zoomCenter(0.8)} title={`Zoom out (${MOD}+-)`}>
            −
          </button>
          <button className="btn zoom" onClick={() => zoomToFit()} title="Zoom to fit (Shift+1)">
            {Math.round(scale * 100)}%
          </button>
          <button className="btn" onClick={() => zoomCenter(1.25)} title={`Zoom in (${MOD}+=)`}>
            +
          </button>
          <button className={showLabels ? 'btn on' : 'btn'} onClick={() => set({ showLabels: !showLabels })} title="Show control labels (T)">
            Labels
          </button>
        </div>

        <div className="group right">
          <button className="btn" onClick={cmd.exportJson} title={`Export the whole document as JSON (${MOD}+S)`}>
            Export
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()} title="Import a document JSON (undoable)">
            Import
          </button>
          <button
            className="btn"
            onClick={() => {
              if (confirm('Start a new document? (You can undo this.)')) cmd.resetDoc()
            }}
          >
            New
          </button>
          <button className="btn" onClick={() => set({ dialog: { kind: 'help' } })} title="Shortcuts (?)">
            ?
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) setError(await cmd.importJson(f))
            }}
          />
        </div>
      </div>

      {tool === 'paint' && (
        <div className="palette-bar">
          <span className="hint">Paint: click or drag across pads, steps and buttons · Alt-click picks · Esc ends</span>
          {PALETTE.map((c) => (
            <button key={c} className={paintColor === c ? 'chip on' : 'chip'} style={{ background: c }} onClick={() => set({ paintColor: c })} title={c} />
          ))}
          <button className={paintColor === 'off' ? 'chip off on' : 'chip off'} onClick={() => set({ paintColor: 'off' })} title="LED off">
            off
          </button>
          <input type="color" value={paintColor === 'off' ? '#000000' : paintColor} onChange={(e) => set({ paintColor: e.target.value })} title="Custom colour" />
        </div>
      )}

      {error && (
        <div className="toast" onClick={() => setError(null)}>
          Import failed: {error} (click to dismiss)
        </div>
      )}
    </>
  )
}
