import { useStore, findLayout } from '../store'
import { CONTROL_BY_ID } from '../model/hardware'
import type { ControlMeta, LayoutItem } from '../model/types'

export type MetaField = { key: keyof ControlMeta; label: string; hint: string; multiline?: boolean }

const BASE: MetaField[] = [
  { key: 'label', label: 'Label', hint: 'Short name shown on the layout' },
  { key: 'function', label: 'Function', hint: 'What it does in this layout' },
  { key: 'click', label: 'Quick click', hint: 'Tap / short press' },
  { key: 'hold', label: 'Hold', hint: 'Press and hold' },
  { key: 'doubleClick', label: 'Double-click', hint: 'Double press' },
  { key: 'shift', label: 'Shift + press', hint: 'With Shift held' },
]
const ENCODER: MetaField[] = [
  { key: 'turn', label: 'Turn', hint: 'Turning the encoder' },
  { key: 'touch', label: 'Touch', hint: 'Touching without turning' },
  { key: 'shiftTurn', label: 'Shift + turn', hint: 'Turning with Shift held' },
]
const DESC: MetaField = { key: 'description', label: 'Description', hint: 'Notes, details, edge cases', multiline: true }

/** The metadata fields that apply to a set of controls (encoders get turn/touch too). */
export function fieldsFor(ids: string[]): MetaField[] {
  const encoderish = ids.some((id) => ['knob', 'volume', 'wheel'].includes(CONTROL_BY_ID[id]?.kind ?? ''))
  return [BASE[0], BASE[1], ...(encoderish ? ENCODER : []), ...BASE.slice(2), DESC]
}

export const ALL_META_FIELDS = [...BASE, ...ENCODER, DESC]

/** The common value of a field across controls, or null when they differ. */
export function commonValue(layout: LayoutItem, ids: string[], key: keyof ControlMeta): string | null {
  const vals = new Set(ids.map((id) => layout.controls[id]?.meta?.[key] ?? ''))
  return vals.size === 1 ? [...vals][0] : null
}

/**
 * Live metadata editor for the inspector: every keystroke saves (typing in one
 * field is a single undo step). With several controls, a field shows "mixed"
 * until you type, which then sets it on all of them.
 */
export function MetaFields({ layout, ids }: { layout: LayoutItem; ids: string[] }) {
  const commit = useStore((s) => s.commit)
  const inScope = ids.filter((id) => layout.scope.includes(id))
  const write = (key: keyof ControlMeta, value: string) =>
    commit((d) => {
      const l = findLayout(d, layout.id)
      if (!l) return
      for (const id of inScope) {
        const c = (l.controls[id] ??= {})
        const meta = { ...(c.meta ?? {}) }
        if (value) meta[key] = value
        else delete meta[key]
        c.meta = meta
      }
    }, `meta-${layout.id}-${inScope.join(',')}-${key}`)

  return (
    <div className="meta-fields">
      {fieldsFor(inScope).map((f) => {
        const v = commonValue(layout, inScope, f.key)
        const props = {
          value: v ?? '',
          placeholder: v === null ? 'mixed' : f.hint,
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => write(f.key, e.target.value),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Escape') (e.target as HTMLElement).blur()
          },
        }
        return (
          <label key={f.key} className={f.multiline ? 'full' : ''}>
            {f.label}
            {f.multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
          </label>
        )
      })}
    </div>
  )
}
