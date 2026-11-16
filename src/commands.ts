// User-level commands shared by the toolbar, inspector and keyboard shortcuts.
import { useStore, findLayout } from './store'
import { ALL_CONTROL_IDS } from './model/hardware'
import {
  boundsOf,
  clearControls,
  copyBoard,
  copyControls,
  parseClip,
  pasteBoard,
  pasteControls,
  withContents,
  type Clip,
  type PasteMode,
} from './model/ops'
import { newDoc, newGroup, newLayout, newNote, newScreenItem, normalizeDoc, LAYOUT_W, SCREEN_ITEM_W, SCREEN_ITEM_H, type BoardItem } from './model/types'
import { boardRect, screenToWorld, leaveLayout } from './viewport'

const S = () => useStore.getState()

/** Last thing copied in this tab (also mirrored to the system clipboard and localStorage). */
let internalClip: Clip | null = null
const CLIP_KEY = 'ableton-move-designer:clipboard'

export function getClip(): Clip | null {
  if (internalClip) return internalClip
  try {
    return parseClip(localStorage.getItem(CLIP_KEY) ?? '')
  } catch {
    return null
  }
}

function setClip(c: Clip) {
  internalClip = c
  try {
    localStorage.setItem(CLIP_KEY, JSON.stringify(c))
  } catch {
    /* ignore */
  }
}

function viewCenter() {
  const r = boardRect()
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2)
}

function select(ids: string[]) {
  S().select(ids)
}

export function addLayout() {
  const c = viewCenter()
  const l = newLayout(Math.round(c.x - LAYOUT_W / 2), Math.round(c.y - 300), `Layout ${S().doc.items.filter((i) => i.type === 'layout').length + 1}`, ALL_CONTROL_IDS)
  S().commit((d) => {
    d.items.push(l)
  })
  select([l.id])
  S().activate(null)
}

export function addScreen() {
  const c = viewCenter()
  const n = S().doc.items.filter((i) => i.type === 'screen').length + 1
  const it = newScreenItem(Math.round(c.x - SCREEN_ITEM_W / 2), Math.round(c.y - SCREEN_ITEM_H / 2), `Screen ${n}`)
  S().commit((d) => {
    d.items.push(it)
  })
  select([it.id])
  S().activate(null)
}

export function addNote() {
  const c = viewCenter()
  const n = newNote(Math.round(c.x - 160), Math.round(c.y - 110))
  S().commit((d) => {
    d.items.push(n)
  })
  select([n.id])
}

/** Add a group frame around the selection (or an empty one in the middle of the view). */
export function addGroup() {
  const s = S()
  const sel = s.doc.items.filter((i) => s.selection.includes(i.id))
  const b = boundsOf(sel)
  const pad = 40
  const c = viewCenter()
  const g = b ? newGroup(b.x - pad, b.y - pad - 30, b.w + pad * 2, b.h + pad * 2 + 30) : newGroup(Math.round(c.x - 700), Math.round(c.y - 450))
  s.commit((d) => {
    d.items.unshift(g)
  })
  select([g.id])
}

export function deleteSelection() {
  const s = S()
  if (s.activeLayoutId && s.controlSel.length) return clearSelectedControls('all')
  if (!s.selection.length) return
  const ids = new Set(s.selection)
  s.commit((d) => {
    d.items = d.items.filter((i) => !ids.has(i.id))
  })
  s.select([])
  if (s.activeLayoutId && ids.has(s.activeLayoutId)) leaveLayout()
}

export function clearSelectedControls(mode: PasteMode) {
  const s = S()
  if (!s.activeLayoutId || !s.controlSel.length) return
  s.commit((d) => {
    const l = findLayout(d, s.activeLayoutId)
    if (l) clearControls(l, s.controlSel, mode)
  })
}

export function nudge(dx: number, dy: number) {
  const s = S()
  if (!s.selection.length) return
  const ids = new Set(withContents(s.doc, s.selection))
  s.commit((d) => {
    for (const it of d.items)
      if (ids.has(it.id)) {
        it.x += dx
        it.y += dy
      }
  })
}

export function selectAll() {
  const s = S()
  const l = findLayout(s.doc, s.activeLayoutId)
  if (l) s.set({ controlSel: [...l.scope] })
  else s.select(s.doc.items.map((i) => i.id))
}

/** Copy: controls of the active layout if any are selected, otherwise board items. */
export function copy(): Clip | null {
  const s = S()
  const l = findLayout(s.doc, s.activeLayoutId)
  let clip: Clip | null = null
  if (l && s.controlSel.length) clip = copyControls(l, s.controlSel)
  else if (s.selection.length) clip = copyBoard(s.doc, s.selection)
  if (clip) setClip(clip)
  return clip
}

export function cut(): Clip | null {
  const clip = copy()
  if (clip?.kind === 'amd-controls') clearSelectedControls('all')
  else if (clip) deleteSelection()
  return clip
}

export function duplicate() {
  const s = S()
  if (!s.selection.length) return
  const clip = copyBoard(s.doc, s.selection)
  let ids: string[] = []
  s.commit((d) => {
    ids = pasteBoard(d, clip, 40, 40)
  })
  const top = new Set(s.selection)
  select(ids.filter((_, i) => top.has(clip.items[i].id)))
  s.activate(null)
}

/**
 * Paste. Control data goes onto the selected controls of the active layout
 * (or onto the same controls of every selected layout). Board items are
 * pasted offset from the originals.
 */
export function paste(clip: Clip | null = getClip(), mode: PasteMode = 'all') {
  if (!clip) return
  const s = S()
  if (clip.kind === 'amd-controls') {
    const active = findLayout(s.doc, s.activeLayoutId)
    const targets = active ? [active.id] : s.selection.filter((id) => findLayout(s.doc, id))
    if (!targets.length) return
    s.commit((d) => {
      for (const id of targets) {
        const l = findLayout(d, id)
        if (l) pasteControls(l, clip, active ? s.controlSel : [], mode)
      }
    })
    return
  }
  let ids: string[] = []
  const pastedIds = new Set(clip.items.map((i) => i.id))
  // Paste on top of the originals (offset) if they are still here, otherwise at the view centre.
  const existing = s.doc.items.some((i) => pastedIds.has(i.id))
  const b = boundsOf(clip.items)!
  const c = viewCenter()
  const dx = existing ? 40 : Math.round(c.x - (b.x + b.w / 2))
  const dy = existing ? 40 : Math.round(c.y - (b.y + b.h / 2))
  s.commit((d) => {
    ids = pasteBoard(d, clip, dx, dy)
  })
  // Rewrite the clipboard so repeated pastes cascade.
  setClip({ kind: 'amd-board', items: clip.items.map((it) => ({ ...it, x: it.x + (existing ? 40 : 0), y: it.y + (existing ? 40 : 0) })) as BoardItem[] })
  select(ids)
  s.activate(null)
}

export function bringToFront() {
  const s = S()
  const ids = new Set(s.selection)
  s.commit((d) => {
    const moving = d.items.filter((i) => ids.has(i.id))
    d.items = [...d.items.filter((i) => !ids.has(i.id)), ...moving]
  })
}

// ---- files ----------------------------------------------------------------

export function exportJson() {
  const { doc } = S()
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const name = (doc.name || 'move-layouts').replace(/[^\w-]+/g, '-').toLowerCase()
  a.download = `${name}.movedesign.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export async function importJson(file: File) {
  try {
    const doc = normalizeDoc(JSON.parse(await file.text()))
    S().replaceDoc(doc)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

export function resetDoc() {
  S().replaceDoc(newDoc())
}
