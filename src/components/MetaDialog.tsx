import { useEffect, useMemo, useState } from 'react'
import { useStore, findLayout } from '../store'
import { CONTROL_BY_ID, readingOrder } from '../model/hardware'
import type { ControlMeta } from '../model/types'
import { midiText } from './Inspector'
import { MOD } from '../shortcuts'

type Field = { key: keyof ControlMeta; label: string; hint: string; multiline?: boolean }

const BASE: Field[] = [
  { key: 'label', label: 'Label', hint: 'Short name shown on the layout' },
  { key: 'function', label: 'Function', hint: 'What it does in this layout' },
  { key: 'click', label: 'Quick click', hint: 'Tap / short press' },
  { key: 'hold', label: 'Hold', hint: 'Press and hold' },
  { key: 'doubleClick', label: 'Double-click', hint: 'Double press' },
  { key: 'shift', label: 'Shift + press', hint: 'With Shift held' },
]
const ENCODER: Field[] = [
  { key: 'turn', label: 'Turn', hint: 'Turning the encoder' },
  { key: 'touch', label: 'Touch', hint: 'Touching without turning' },
  { key: 'shiftTurn', label: 'Shift + turn', hint: 'Turning with Shift held' },
]
const DESC: Field = { key: 'description', label: 'Description', hint: 'Notes, details, edge cases', multiline: true }

const MIXED = '\u0000mixed'

export function MetaDialog({ layoutId, controlIds }: { layoutId: string; controlIds: string[] }) {
  const layout = useStore((s) => findLayout(s.doc, layoutId))
  const commit = useStore((s) => s.commit)
  const close = () => useStore.getState().set({ dialog: null })
  const ids = useMemo(() => readingOrder(controlIds.filter((id) => layout?.scope.includes(id))), [controlIds, layout])
  const defs = ids.map((id) => CONTROL_BY_ID[id])
  const encoderish = defs.some((d) => d.kind === 'knob' || d.kind === 'volume' || d.kind === 'wheel')
  const fields = [BASE[0], BASE[1], ...(encoderish ? ENCODER : []), ...BASE.slice(2), DESC]

  // Initial values: common value across the selection, or MIXED.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const f of [...BASE, ...ENCODER, DESC]) {
      const vals = new Set(ids.map((id) => layout?.controls[id]?.meta?.[f.key] ?? ''))
      out[f.key] = vals.size === 1 ? [...vals][0] : MIXED
    }
    return out
  })
  const [touched, setTouched] = useState<Set<string>>(new Set())

  const save = () => {
    if (touched.size)
      commit((d) => {
        const l = findLayout(d, layoutId)
        if (!l) return
        for (const id of ids) {
          const c = (l.controls[id] ??= {})
          const meta = { ...(c.meta ?? {}) }
          for (const k of touched) {
            const v = values[k]
            if (v === MIXED) continue
            if (v) meta[k as keyof ControlMeta] = v
            else delete meta[k as keyof ControlMeta]
          }
          c.meta = meta
        }
      })
    close()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!layout || !ids.length) return null
  const title = ids.length === 1 ? defs[0].name : `${ids.length} controls`

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && save()}>
      <form
        className="modal meta-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <header>
          <h2>{title}</h2>
          <span className="muted">
            {layout.name}
            {ids.length === 1 && defs[0].midi ? ` · ${midiText(defs[0].midi)}` : ''}
            {ids.length === 1 && defs[0].shiftLabel ? ` · printed: Shift + ${defs[0].shiftLabel}` : ''}
          </span>
        </header>
        {ids.length > 1 && <p className="muted small">Editing {ids.length} controls at once. Fields marked “mixed” stay as they are unless you type in them.</p>}
        <div className="fields">
          {fields.map((f, i) => {
            const v = values[f.key]
            const mixed = v === MIXED
            const props = {
              value: mixed ? '' : v,
              placeholder: mixed ? 'mixed' : f.hint,
              autoFocus: i === 0,
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                setValues({ ...values, [f.key]: e.target.value })
                setTouched(new Set(touched).add(f.key))
              },
            }
            return (
              <label key={f.key} className={f.multiline ? 'full' : ''}>
                <span>{f.label}</span>
                {f.multiline ? <textarea rows={4} {...props} /> : <input {...props} />}
              </label>
            )
          })}
        </div>
        <footer>
          <span className="muted small">
            {MOD}+Enter saves · Esc cancels
          </span>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </footer>
      </form>
    </div>
  )
}
