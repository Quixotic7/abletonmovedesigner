import { useEffect } from 'react'
import { useStore } from '../store'
import { MOD } from '../shortcuts'

const ROWS: [string, string][] = [
  ['Pan', 'Middle-mouse drag · Space + drag · Shift + scroll · sideways scroll'],
  ['Zoom', `Scroll wheel (toward cursor) · pinch · ${MOD} + = / −`],
  ['Zoom to fit / selection', 'Shift+1 / Shift+2 · click the % button'],
  ['Select', 'Click · Shift-click to add · drag a box on empty space'],
  ['Edit a layout', 'Click any control on it (edits in place) · double-click its title to focus'],
  ['Back to the board', 'Esc · breadcrumb · ← Back'],
  ['Control metadata', 'Double-click a control · Enter with controls selected'],
  ['Screen mockup', 'Double-click the screen: layers, text, dithers, selection and animation frames (shortcuts listed in the editor)'],
  ['Paint LEDs', 'B, then click/drag over pads, steps, buttons · Alt-click picks · Esc ends'],
  ['Copy / cut / paste', `${MOD}+C / X / V (controls or board items)`],
  ['Paste metadata only', `${MOD}+Shift+V`],
  ['Paste colours only', `${MOD}+Alt+V`],
  ['Duplicate', `${MOD}+D`],
  ['Select all', `${MOD}+A (all controls in scope while editing a layout)`],
  ['Undo / redo', `${MOD}+Z / ${MOD}+Shift+Z`],
  ['Delete', 'Delete / Backspace (on controls: clears metadata + LED)'],
  ['Nudge', 'Arrow keys (Shift = 10 px)'],
  ['New layout / screen / note / group', `L / S / N / ${MOD}+G (frames the selection)`],
  ['Labels on/off', 'T'],
  ['Export', `${MOD}+S`],
]

export function HelpDialog() {
  const close = () => useStore.getState().set({ dialog: null })
  useEffect(() => {
    const k = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === '?') && close()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal help">
        <header>
          <h2>Shortcuts</h2>
        </header>
        <table>
          <tbody>
            {ROWS.map(([a, b]) => (
              <tr key={a}>
                <td>{a}</td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer>
          <span className="muted small">Everything autosaves in this browser. Export to keep a file.</span>
          <button className="btn primary" onClick={close}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
