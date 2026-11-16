import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useStore, findLayout } from '../store'
import type { BoardItem, GroupItem, LayoutItem, NoteItem } from '../model/types'
import { CONTROL_BY_ID, CONTROLS, describeScope, shapeBounds } from '../model/hardware'
import { intersects, ledForPaint, pickColor, withContents, type Rect } from '../model/ops'
import { MoveSurface } from './MoveSurface'
import {
  boardRef,
  CARD_DEVICE_X,
  CARD_DEVICE_Y,
  CARD_SVG_Y,
  focusLayout,
  screenToWorld,
  zoomAt,
} from '../viewport'

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | {
      kind: 'move'
      sx: number
      sy: number
      ids: string[]
      orig: Map<string, { x: number; y: number }>
      moved: boolean
      click?: { layoutId: string; controlId: string }
    }
  | { kind: 'marquee'; sx: number; sy: number; additive: boolean; base: string[]; layoutId?: string }
  | { kind: 'paint'; done: Set<string>; lx: number; ly: number }
  | { kind: 'resize'; id: string; sx: number; sy: number; ow: number; oh: number }

const DRAG_THRESHOLD = 4

export function Board() {
  const ref = useRef<HTMLDivElement>(null)
  const items = useStore((s) => s.doc.items)
  const view = useStore((s) => s.view)
  const selection = useStore((s) => s.selection)
  const activeLayoutId = useStore((s) => s.activeLayoutId)
  const controlSel = useStore((s) => s.controlSel)
  const showLabels = useStore((s) => s.showLabels)
  const tool = useStore((s) => s.tool)
  const scopeEdit = useStore((s) => s.scopeEdit)
  const gesture = useRef<Gesture | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const doneEditing = useCallback(() => setEditing(null), [])

  useEffect(() => {
    boardRef.el = ref.current
  }, [])

  // A drag must never outlive the button press, wherever the release happens.
  useEffect(() => {
    const end = () => gesture.current && onPointerUpRef.current()
    window.addEventListener('pointerup', end)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('blur', end)
    }
  }, [])

  // Space-to-pan.
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return !!t?.closest?.('input, textarea, [contenteditable="true"], select')
    }
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        e.preventDefault()
        setSpaceHeld(true)
      }
    }
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false)
    const blur = () => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // Wheel: zoom toward cursor; pinch (ctrlKey) zooms; sideways scroll (or Shift) pans.
  useEffect(() => {
    const el = ref.current!
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('textarea')) return
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const dx = e.deltaX * unit
      const dy = e.deltaY * unit
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.01))
      } else if (Math.abs(dx) > Math.abs(dy) || e.shiftKey) {
        // Mostly-sideways scrolling pans. Mice and Magic Mice often send a little
        // sideways movement with a vertical scroll; that still zooms.
        const v = useStore.getState().view
        useStore.getState().setView({ ...v, x: v.x - (e.shiftKey && !dx ? dy : dx), y: v.y - (e.shiftKey && !dx ? 0 : dy) })
      } else {
        zoomAt(e.clientX, e.clientY, Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.0045))
      }
    }
    // Safari pinch
    let lastScale = 1
    const gs = (e: Event) => {
      e.preventDefault()
      lastScale = 1
    }
    const gc = (e: Event) => {
      e.preventDefault()
      const ge = e as Event & { scale: number; clientX: number; clientY: number }
      zoomAt(ge.clientX, ge.clientY, ge.scale / lastScale)
      lastScale = ge.scale
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', gs)
    el.addEventListener('gesturechange', gc)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', gs)
      el.removeEventListener('gesturechange', gc)
    }
  }, [])

  const capture = (id: number) => {
    try {
      ref.current!.setPointerCapture(id)
    } catch {
      /* synthetic or already-released pointer */
    }
  }

  const onPointerDown = (e: RPointerEvent) => {
    const s = useStore.getState()
    const target = e.target as Element
    if (target.closest('textarea, input')) return
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault()
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: s.view.x, vy: s.view.y }
      setPanning(true)
      capture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    ;(document.activeElement as HTMLElement | null)?.blur?.()

    const resizeEl = target.closest('[data-resize-id]')
    if (resizeEl) {
      const id = resizeEl.getAttribute('data-resize-id')!
      const it = s.doc.items.find((i) => i.id === id)!
      s.checkpoint()
      gesture.current = { kind: 'resize', id, sx: e.clientX, sy: e.clientY, ow: it.w, oh: it.h }
      capture(e.pointerId)
      return
    }

    const ctlEl = target.closest('[data-control-id]')
    const cardEl = target.closest('[data-item-id]')
    const layoutId = cardEl?.getAttribute('data-layout-card') ?? null
    const controlId = ctlEl?.getAttribute('data-control-id') ?? null
    const layout = findLayout(s.doc, layoutId)
    const inScope = !!(layout && controlId && layout.scope.includes(controlId))

    // Paint tool: click / drag across controls of any layout.
    if (s.tool === 'paint' && layout && controlId) {
      if (e.altKey) {
        if (inScope) s.set({ paintColor: pickColor(CONTROL_BY_ID[controlId], layout.controls[controlId]) })
        return
      }
      s.checkpoint()
      gesture.current = { kind: 'paint', done: new Set(), lx: e.clientX, ly: e.clientY }
      paintAt(e.clientX, e.clientY, gesture.current.done)
      capture(e.pointerId)
      return
    }

    // Scope editing: click toggles a control in/out of the active layout's scope.
    if (s.scopeEdit && layout && layout.id === s.activeLayoutId && controlId) {
      s.commit((d) => {
        const l = findLayout(d, layout.id)!
        const i = l.scope.indexOf(controlId)
        if (i >= 0) l.scope.splice(i, 1)
        else l.scope.push(controlId)
      })
      return
    }

    // Inside the active layout: select controls, marquee on the body.
    if (layout && layout.id === s.activeLayoutId && target.closest('[data-layout-body]')) {
      if (controlId && inScope) {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey
        if (additive) {
          s.set({ controlSel: s.controlSel.includes(controlId) ? s.controlSel.filter((c) => c !== controlId) : [...s.controlSel, controlId] })
        } else if (!s.controlSel.includes(controlId)) {
          s.set({ controlSel: [controlId] })
        }
        gesture.current = { kind: 'marquee', sx: e.clientX, sy: e.clientY, additive: true, base: useStore.getState().controlSel, layoutId: layout.id }
      } else {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey
        if (!additive) s.set({ controlSel: [] })
        gesture.current = { kind: 'marquee', sx: e.clientX, sy: e.clientY, additive, base: additive ? s.controlSel : [], layoutId: layout.id }
      }
      capture(e.pointerId)
      return
    }

    // Board items: select + move.
    if (cardEl) {
      const id = cardEl.getAttribute('data-item-id')!
      const handle = target.closest('[data-handle]') || layout
      if (handle) {
        let sel = s.selection
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
        } else if (!sel.includes(id)) {
          sel = [id]
        }
        s.select(sel)
        if (s.activeLayoutId && s.activeLayoutId !== id) s.activate(null)
        if (!sel.includes(id)) return
        const ids = withContents(s.doc, sel)
        const orig = new Map(s.doc.items.filter((i) => ids.includes(i.id)).map((i) => [i.id, { x: i.x, y: i.y }]))
        gesture.current = {
          kind: 'move',
          sx: e.clientX,
          sy: e.clientY,
          ids,
          orig,
          moved: false,
          click: layout && controlId && inScope && !e.shiftKey ? { layoutId: layout.id, controlId } : undefined,
        }
        capture(e.pointerId)
        return
      }
    }

    // Empty canvas (or a group's body): marquee-select board items.
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    if (!additive) s.select([])
    if (s.activeLayoutId) s.activate(null)
    gesture.current = { kind: 'marquee', sx: e.clientX, sy: e.clientY, additive, base: additive ? s.selection : [] }
    capture(e.pointerId)
  }

  const onPointerMove = (e: RPointerEvent) => {
    const g = gesture.current
    if (!g) return
    if (e.buttons === 0 && e.pointerType === 'mouse') {
      // The button was released somewhere we never heard about: finish the gesture.
      onPointerUp()
      return
    }
    const s = useStore.getState()
    switch (g.kind) {
      case 'pan':
        s.setView({ ...s.view, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy })
        break
      case 'move': {
        const dx = (e.clientX - g.sx) / s.view.scale
        const dy = (e.clientY - g.sy) / s.view.scale
        if (!g.moved) {
          if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_THRESHOLD) return
          g.moved = true
          s.checkpoint()
        }
        s.mutate((d) => {
          for (const it of d.items) {
            const o = g.orig.get(it.id)
            if (o) {
              it.x = Math.round(o.x + dx)
              it.y = Math.round(o.y + dy)
            }
          }
        })
        break
      }
      case 'resize': {
        const dx = (e.clientX - g.sx) / s.view.scale
        const dy = (e.clientY - g.sy) / s.view.scale
        s.mutate((d) => {
          const it = d.items.find((i) => i.id === g.id)
          if (!it) return
          it.w = Math.max(120, Math.round(g.ow + dx))
          it.h = Math.max(80, Math.round(g.oh + dy))
        })
        break
      }
      case 'paint': {
        // Sample along the segment so quick strokes don't skip controls.
        const n = Math.max(1, Math.ceil(Math.hypot(e.clientX - g.lx, e.clientY - g.ly) / 6))
        for (let i = 1; i <= n; i++) paintAt(g.lx + ((e.clientX - g.lx) * i) / n, g.ly + ((e.clientY - g.ly) * i) / n, g.done)
        g.lx = e.clientX
        g.ly = e.clientY
        break
      }
      case 'marquee': {
        const r = boardRef.el!.getBoundingClientRect()
        const x0 = Math.min(g.sx, e.clientX)
        const y0 = Math.min(g.sy, e.clientY)
        const w = Math.abs(e.clientX - g.sx)
        const h = Math.abs(e.clientY - g.sy)
        if (w + h < DRAG_THRESHOLD) return
        setMarquee({ x: x0 - r.left, y: y0 - r.top, w, h })
        const a = screenToWorld(x0, y0)
        const b = screenToWorld(x0 + w, y0 + h)
        const wr = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
        if (g.layoutId) {
          const l = findLayout(s.doc, g.layoutId)
          if (!l) return
          const local = { x: wr.x - l.x - CARD_DEVICE_X, y: wr.y - l.y - CARD_DEVICE_Y, w: wr.w, h: wr.h }
          const scope = new Set(l.scope)
          const hit = CONTROLS.filter((c) => scope.has(c.id) && intersects(local, shapeBounds(c.shape))).map((c) => c.id)
          s.set({ controlSel: [...new Set([...g.base, ...hit])] })
        } else {
          // Groups must be fully enclosed; other items just touched.
          const hit = s.doc.items
            .filter((it) => (it.type === 'group' ? wr.x <= it.x && wr.y <= it.y && wr.x + wr.w >= it.x + it.w && wr.y + wr.h >= it.y + it.h : intersects(wr, it)))
            .map((it) => it.id)
          s.select([...new Set([...g.base, ...hit])])
        }
        break
      }
    }
  }

  const onPointerUp = () => {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    setMarquee(null)
    setPanning(false)
    if (g?.kind === 'move' && !g.moved && g.click) {
      const s = useStore.getState()
      s.select([g.click.layoutId])
      s.activate(g.click.layoutId, [g.click.controlId])
    }
  }

  const onPointerUpRef = useRef(onPointerUp)
  onPointerUpRef.current = onPointerUp

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = useStore.getState()
    // Pointer capture retargets click events to the board, so hit-test instead.
    const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element)
    if (target.closest('textarea, input')) return
    const ctlEl = target.closest('[data-control-id]')
    const cardEl = target.closest('[data-item-id]')
    const id = cardEl?.getAttribute('data-item-id')
    const layout = findLayout(s.doc, cardEl?.getAttribute('data-layout-card') ?? null)
    if (layout && ctlEl && s.tool === 'select' && !s.scopeEdit) {
      const cid = ctlEl.getAttribute('data-control-id')!
      if (!layout.scope.includes(cid)) return
      s.select([layout.id])
      s.activate(layout.id, [cid])
      s.set({ dialog: cid === 'screen' ? { kind: 'screen', layoutId: layout.id } : { kind: 'meta', layoutId: layout.id, controlIds: [cid] } })
      return
    }
    if (layout && target.closest('[data-handle]')) {
      focusLayout(layout.id)
      return
    }
    if (id && cardEl?.getAttribute('data-item-type') !== 'layout') {
      if (cardEl?.getAttribute('data-item-type') === 'note' || target.closest('[data-handle]')) setEditing(id)
    }
  }

  function paintAt(clientX: number, clientY: number, done: Set<string>) {
    const el = document.elementFromPoint(clientX, clientY)
    const ctl = el?.closest('[data-control-id]')
    const card = el?.closest('[data-layout-card]')
    if (!ctl || !card) return
    const lid = card.getAttribute('data-layout-card')!
    const cid = ctl.getAttribute('data-control-id')!
    const key = lid + '/' + cid
    if (done.has(key)) return
    done.add(key)
    const s = useStore.getState()
    const def = CONTROL_BY_ID[cid]
    const led = def && ledForPaint(def, s.paintColor)
    if (!led) return
    s.mutate((d) => {
      const l = findLayout(d, lid)
      if (!l || !l.scope.includes(cid)) return
      ;(l.controls[cid] ??= {}).led = led
    })
  }

  const groups = items.filter((i) => i.type === 'group')
  const others = items.filter((i) => i.type !== 'group')
  const selSet = new Set(selection)
  const cursor = panning ? 'grabbing' : spaceHeld ? 'grab' : tool === 'paint' ? 'crosshair' : 'default'

  return (
    <div
      ref={ref}
      className={`board tool-${tool}${scopeEdit ? ' scope-editing' : ''}`}
      style={{ cursor, backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${40 * view.scale}px ${40 * view.scale}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onDoubleClick={onDoubleClick}
      onAuxClick={(e) => e.button === 1 && e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        {[...groups, ...others].map((it) => (
          <Item
            key={it.id}
            item={it}
            selected={selSet.has(it.id)}
            active={it.id === activeLayoutId}
            controlSel={it.id === activeLayoutId ? controlSel : undefined}
            showLabels={showLabels}
            scopeEdit={scopeEdit && it.id === activeLayoutId}
            editing={editing === it.id}
            onDoneEditing={doneEditing}
            scale={it.type === 'group' ? view.scale : 1}
          />
        ))}
      </div>
      {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
    </div>
  )
}

interface ItemProps {
  item: BoardItem
  selected: boolean
  active: boolean
  controlSel?: string[]
  showLabels: boolean
  scopeEdit: boolean
  editing: boolean
  onDoneEditing: () => void
  scale: number
}

const Item = memo(function Item(p: ItemProps) {
  const { item } = p
  const style = { left: item.x, top: item.y, width: item.w, height: item.h }
  const cls = `item item-${item.type}${p.selected ? ' selected' : ''}${p.active ? ' active' : ''}`
  const common = { 'data-item-id': item.id, 'data-item-type': item.type, className: cls, style }
  if (item.type === 'layout') return <LayoutCard {...p} item={item} common={common} />
  if (item.type === 'note') return <Note {...p} item={item} common={common} />
  return <Group {...p} item={item} common={common} />
})

type Common = Record<string, unknown>

function LayoutCard({ item, common, active, controlSel, showLabels, scopeEdit, selected }: ItemProps & { item: LayoutItem; common: Common }) {
  return (
    <div {...common} data-layout-card={item.id}>
      <div className="card-head" data-handle>
        <div className="card-title">{item.name || 'Untitled layout'}</div>
        <div className="card-scope" title="Scope: controls this layout covers">
          {describeScope(item.scope)}
        </div>
        <div className="card-desc">{item.description}</div>
        {(active || selected) && <div className="card-hint">{active ? 'Editing - Esc to leave' : 'Click a control to edit · double-click title to focus'}</div>}
      </div>
      <div className="card-device" style={{ left: CARD_DEVICE_X, top: CARD_SVG_Y }}>
        <MoveSurface layout={item} selected={controlSel} showLabels={showLabels} scopeEdit={scopeEdit} />
      </div>
    </div>
  )
}

function Note({ item, common, editing, onDoneEditing }: ItemProps & { item: NoteItem; common: Common }) {
  const commit = useStore((s) => s.commit)
  return (
    <div {...common} data-handle style={{ ...(common.style as object), background: item.color }}>
      {editing ? (
        <textarea
          autoFocus
          defaultValue={item.text}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const v = e.currentTarget.value
            if (v !== item.text)
              commit((d) => {
                const n = d.items.find((i) => i.id === item.id) as NoteItem | undefined
                if (n) n.text = v
              })
            onDoneEditing()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.stopPropagation()
              e.currentTarget.blur()
            }
          }}
        />
      ) : (
        <div className="note-text">{item.text || <span className="placeholder">Double-click to write</span>}</div>
      )}
      <div className="resize" data-resize-id={item.id} />
    </div>
  )
}

function Group({ item, common, editing, onDoneEditing, scale }: ItemProps & { item: GroupItem; common: Common }) {
  const commit = useStore((s) => s.commit)
  const titleScale = Math.max(1, 0.6 / scale)
  return (
    <div {...common} style={{ ...(common.style as object), borderColor: item.color, background: item.color + '14' }}>
      <div className="group-title" data-handle style={{ background: item.color, transform: `scale(${titleScale})` }}>
        {editing ? (
          <input
            autoFocus
            defaultValue={item.title}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              const v = e.currentTarget.value
              if (v !== item.title)
                commit((d) => {
                  const g = d.items.find((i) => i.id === item.id) as GroupItem | undefined
                  if (g) g.title = v
                })
              onDoneEditing()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.stopPropagation()
                e.currentTarget.blur()
              }
            }}
          />
        ) : (
          item.title || 'Group'
        )}
      </div>
      <div className="resize" data-resize-id={item.id} />
    </div>
  )
}
