import { useStore, findLayout, findItem } from '../store'
import { CONTROL_BY_ID, SCOPE_GROUPS, controlsInGroup, describeScope, ALL_CONTROL_IDS } from '../model/hardware'
import { GROUP_COLORS, NOTE_COLORS, newScreenItem, type GroupItem, type LayoutItem, type NoteItem, type ScreenItem } from '../model/types'
import { PALETTE, ledForPaint, type PasteMode } from '../model/ops'
import * as cmd from '../commands'
import { MOD } from '../shortcuts'
import { focusLayout } from '../viewport'
import { screenDataUrl } from '../lib/bitmap'
import { MetaFields } from './MetaFields'

export function Inspector() {
  const active = useStore((s) => findLayout(s.doc, s.activeLayoutId))
  const single = useStore((s) => (s.selection.length === 1 ? findItem(s.doc, s.selection[0]) : undefined))
  if (active) return <LayoutPanel layout={active} />
  if (!single) return null
  if (single.type === 'layout') return <LayoutPanel layout={single} compact />
  if (single.type === 'note') return <NotePanel note={single} />
  if (single.type === 'screen') return <ScreenItemPanel item={single} />
  return <GroupPanel group={single} />
}

function LayoutPanel({ layout, compact }: { layout: LayoutItem; compact?: boolean }) {
  const commit = useStore((s) => s.commit)
  const controlSel = useStore((s) => s.controlSel)
  const scopeEdit = useStore((s) => s.scopeEdit)
  const set = useStore((s) => s.set)
  const upd = (fn: (l: LayoutItem) => void, key?: string) =>
    commit((d) => {
      const l = findLayout(d, layout.id)
      if (l) fn(l)
    }, key)
  const scope = new Set(layout.scope)

  return (
    <aside className="inspector" onPointerDown={(e) => e.stopPropagation()}>
      {!compact && controlSel.length > 0 && <SelectionSection layout={layout} ids={controlSel} />}
      <section>
        <h3>Layout</h3>
        <label>
          Name
          <input value={layout.name} onChange={(e) => upd((l) => void (l.name = e.target.value), `name-${layout.id}`)} />
        </label>
        <label>
          Description
          <textarea rows={3} value={layout.description} onChange={(e) => upd((l) => void (l.description = e.target.value), `desc-${layout.id}`)} />
        </label>
        {compact && (
          <button className="btn wide" onClick={() => focusLayout(layout.id)}>
            Edit layout (double-click title)
          </button>
        )}
      </section>

      <section>
        <h3>
          Scope <span className="muted">{describeScope(layout.scope)}</span>
        </h3>
        <div className="scope-grid">
          {SCOPE_GROUPS.map((g) => {
            const ids = controlsInGroup(g.id)
            const n = ids.filter((id) => scope.has(id)).length
            return (
              <label key={g.id} className="check">
                <input
                  type="checkbox"
                  checked={n === ids.length}
                  ref={(el) => {
                    if (el) el.indeterminate = n > 0 && n < ids.length
                  }}
                  onChange={(e) =>
                    upd((l) => {
                      const s = new Set(l.scope)
                      ids.forEach((id) => (e.target.checked ? s.add(id) : s.delete(id)))
                      l.scope = ALL_CONTROL_IDS.filter((id) => s.has(id))
                    })
                  }
                />
                {g.name}
              </label>
            )
          })}
        </div>
        <div className="row">
          <button className="btn small" onClick={() => upd((l) => void (l.scope = [...ALL_CONTROL_IDS]))}>
            All
          </button>
          <button className="btn small" onClick={() => upd((l) => void (l.scope = []))}>
            None
          </button>
          {!compact && (
            <button className={scopeEdit ? 'btn small on' : 'btn small'} onClick={() => set({ scopeEdit: !scopeEdit })} title="Click controls on the layout to add/remove them">
              {scopeEdit ? 'Done picking' : 'Pick controls…'}
            </button>
          )}
        </div>
        <p className="muted small">Controls outside the scope are dimmed and can't be edited in this layout.</p>
      </section>

      {!compact && controlSel.length === 0 && <SelectionSection layout={layout} ids={controlSel} />}

      {!compact && scope.has('screen') && (
        <section>
          <h3>Screen</h3>
          <img className="screen-thumb" src={screenDataUrl(layout.screen)} alt="Screen mockup" onClick={() => set({ dialog: { kind: 'screen', layoutId: layout.id } })} />
          <button className="btn wide" onClick={() => set({ dialog: { kind: 'screen', layoutId: layout.id } })}>
            Edit screen…
          </button>
          <button
            className="btn wide"
            title="Put a copy of this screen on the board as its own item"
            onClick={() => {
              const it = newScreenItem(layout.x + layout.w + 60, layout.y, `${layout.name} screen`)
              it.screen = layout.screen
              if (layout.screenFrames) it.screenFrames = structuredClone(layout.screenFrames)
              commit((d) => {
                d.items.push(it)
              })
            }}
          >
            Copy to board as a screen
          </button>
        </section>
      )}
    </aside>
  )
}

function SelectionSection({ layout, ids }: { layout: LayoutItem; ids: string[] }) {
  const commit = useStore((s) => s.commit)
  const set = useStore((s) => s.set)
  if (!ids.length)
    return (
      <section>
        <h3>Controls</h3>
        <p className="muted small">
          Click a control to select it, Shift-click or drag a box for more. Double-click (or Enter) edits metadata. {MOD}+C / {MOD}+V copies metadata and LEDs between controls and layouts.
        </p>
      </section>
    )
  const defs = ids.map((id) => CONTROL_BY_ID[id]).filter(Boolean)
  const rgb = defs.some((d) => d.led === 'rgb')
  const white = defs.some((d) => d.led === 'white')
  const first = defs[0]
  const st = layout.controls[first.id]
  const applyPaint = (paint: string) =>
    commit((d) => {
      const l = findLayout(d, layout.id)
      if (!l) return
      for (const def of defs) {
        const led = ledForPaint(def, paint)
        if (led && l.scope.includes(def.id)) (l.controls[def.id] ??= {}).led = led
      }
    })
  const setBrightness = (b: number) =>
    commit((d) => {
      const l = findLayout(d, layout.id)
      if (!l) return
      for (const def of defs) if (def.led === 'white' && l.scope.includes(def.id)) (l.controls[def.id] ??= {}).led = { brightness: b }
    })
  const doPaste = (mode: PasteMode) => cmd.paste(cmd.getClip(), mode)

  return (
    <section>
      <h3>
        {defs.length === 1 ? first.name : `${defs.length} controls`}
      </h3>
      {ids.every((id) => id === 'screen') ? (
        <button className="btn wide primary" onClick={() => set({ dialog: { kind: 'screen', layoutId: layout.id } })}>
          Edit screen…
        </button>
      ) : (
        <MetaFields layout={layout} ids={ids} />
      )}
      {defs.length === 1 && (first.midi || first.shiftLabel) && (
        <dl className="meta-summary">
          {first.midi && (
            <div>
              <dt>MIDI</dt>
              <dd className="mono">{midiText(first.midi)}</dd>
            </div>
          )}
          {first.shiftLabel && (
            <div>
              <dt>Printed</dt>
              <dd>Shift + {first.shiftLabel}</dd>
            </div>
          )}
        </dl>
      )}
      {!ids.every((id) => id === 'screen') && (
        <button className="btn small link-btn" onClick={() => set({ dialog: { kind: 'meta', layoutId: layout.id, controlIds: ids } })} title="Bigger editor (double-click a control, or Enter)">
          Open in dialog
        </button>
      )}

      {rgb && (
        <>
          <h4>LED colour</h4>
          <div className="chips">
            {PALETTE.map((c) => (
              <button key={c} className="chip" style={{ background: c }} onClick={() => applyPaint(c)} title={c} />
            ))}
            <button className="chip off" onClick={() => applyPaint('off')} title="Off">
              off
            </button>
            <input type="color" value={(defs.length === 1 && st?.led?.color) || '#ffffff'} onChange={(e) => applyPaint(e.target.value)} title="Custom colour" />
          </div>
        </>
      )}
      {white && (
        <>
          <h4>LED brightness (white)</h4>
          <div className="row">
            {[0, 0.25, 0.5, 0.75, 1].map((b) => (
              <button key={b} className={defs.length === 1 && (st?.led?.brightness ?? 0) === b ? 'btn small on' : 'btn small'} onClick={() => setBrightness(b)}>
                {b === 0 ? 'Off' : `${b * 100}%`}
              </button>
            ))}
          </div>
        </>
      )}

      <h4>Clipboard</h4>
      <div className="row wrap">
        <button className="btn small" onClick={() => cmd.copy()} title={`${MOD}+C`}>
          Copy
        </button>
        <button className="btn small" onClick={() => doPaste('all')} title={`${MOD}+V`}>
          Paste all
        </button>
        <button className="btn small" onClick={() => doPaste('meta')} title={`${MOD}+Shift+V`}>
          Paste metadata
        </button>
        <button className="btn small" onClick={() => doPaste('led')} title={`${MOD}+Alt+V`}>
          Paste colours
        </button>
        <button className="btn small" onClick={() => cmd.clearSelectedControls('all')} title="Delete">
          Clear
        </button>
      </div>
    </section>
  )
}

export function midiText(m: NonNullable<(typeof CONTROL_BY_ID)[string]['midi']>) {
  const parts: string[] = []
  if (m.note !== undefined) parts.push(`note ${m.note}`)
  if (m.cc !== undefined) parts.push(`CC ${m.cc}`)
  if (m.touchNote !== undefined) parts.push(`touch note ${m.touchNote}`)
  if (m.clickCc !== undefined) parts.push(`click CC ${m.clickCc}`)
  if (m.ledCc !== undefined) parts.push(`LED CC ${m.ledCc}`)
  return parts.join(' · ')
}

function NotePanel({ note }: { note: NoteItem }) {
  const commit = useStore((s) => s.commit)
  return (
    <aside className="inspector" onPointerDown={(e) => e.stopPropagation()}>
      <section>
        <h3>Note</h3>
        <label>
          Text
          <textarea
            rows={6}
            value={note.text}
            onChange={(e) =>
              commit((d) => {
                const n = findItem<NoteItem>(d, note.id)
                if (n) n.text = e.target.value
              }, `note-${note.id}`)
            }
          />
        </label>
        <h4>Colour</h4>
        <div className="chips">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              className={note.color === c ? 'chip on' : 'chip'}
              style={{ background: c }}
              onClick={() =>
                commit((d) => {
                  const n = findItem<NoteItem>(d, note.id)
                  if (n) n.color = c
                })
              }
            />
          ))}
        </div>
      </section>
    </aside>
  )
}

function GroupPanel({ group }: { group: GroupItem }) {
  const commit = useStore((s) => s.commit)
  return (
    <aside className="inspector" onPointerDown={(e) => e.stopPropagation()}>
      <section>
        <h3>Group</h3>
        <label>
          Title
          <input
            value={group.title}
            onChange={(e) =>
              commit((d) => {
                const g = findItem<GroupItem>(d, group.id)
                if (g) g.title = e.target.value
              }, `group-${group.id}`)
            }
          />
        </label>
        <h4>Colour</h4>
        <div className="chips">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              className={group.color === c ? 'chip on' : 'chip'}
              style={{ background: c }}
              onClick={() =>
                commit((d) => {
                  const g = findItem<GroupItem>(d, group.id)
                  if (g) g.color = c
                })
              }
            />
          ))}
        </div>
        <p className="muted small">Anything inside the frame moves with it. Drag the title to move, the corner to resize.</p>
      </section>
    </aside>
  )
}

function ScreenItemPanel({ item }: { item: ScreenItem }) {
  const commit = useStore((s) => s.commit)
  const set = useStore((s) => s.set)
  const upd = (fn: (it: ScreenItem) => void, key?: string) =>
    commit((d) => {
      const it = findItem<ScreenItem>(d, item.id)
      if (it) fn(it)
    }, key)
  return (
    <aside className="inspector" onPointerDown={(e) => e.stopPropagation()}>
      <section>
        <h3>Screen</h3>
        <label>
          Name
          <input value={item.name} onChange={(e) => upd((it) => void (it.name = e.target.value), `sname-${item.id}`)} />
        </label>
        <label>
          Description
          <textarea rows={3} value={item.description} onChange={(e) => upd((it) => void (it.description = e.target.value), `sdesc-${item.id}`)} />
        </label>
        <img className="screen-thumb" src={screenDataUrl(item.screen)} alt="Screen" onClick={() => set({ dialog: { kind: 'screen', layoutId: item.id } })} />
        <button className="btn wide primary" onClick={() => set({ dialog: { kind: 'screen', layoutId: item.id } })}>
          Edit screen… (double-click)
        </button>
        <p className="muted small">
          {item.screenFrames && item.screenFrames.length > 1 ? `${item.screenFrames.length} frames; hover the screen on the board to play them. ` : ''}A standalone 128×64 screen mockup.
        </p>
      </section>
    </aside>
  )
}
