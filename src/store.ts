import { create } from 'zustand'
import { produce, type Draft } from 'immer'
import { newDoc, normalizeDoc, type BoardItem, type LayoutItem, type MoveDoc, type ScreenHost } from './model/types'

export interface View {
  x: number
  y: number
  scale: number
}

export type Dialog =
  | { kind: 'meta'; layoutId: string; controlIds: string[] }
  /** layoutId: a layout or a standalone screen item. */
  | { kind: 'screen'; layoutId: string }
  | { kind: 'help' }
  | null

export type Tool = 'select' | 'paint'

interface State {
  doc: MoveDoc
  past: MoveDoc[]
  future: MoveDoc[]

  /** Selected board items. */
  selection: string[]
  /** The layout whose controls are being edited (in place on the board). */
  activeLayoutId: string | null
  /** Selected controls inside the active layout. */
  controlSel: string[]
  view: View
  /** View to return to when leaving a focused layout (Esc / breadcrumb). */
  returnView: View | null
  tool: Tool
  /** '#rrggbb' or 'off'. White-LED controls get its brightness. */
  paintColor: string
  showLabels: boolean
  dialog: Dialog
  /** Scope editing: clicking controls toggles them in/out of the layout's scope. */
  scopeEdit: boolean
}

interface Actions {
  /**
   * Apply a change as one undo step. Consecutive commits with the same
   * `coalesceKey` within a short time merge into one step (typing in a field).
   */
  commit: (recipe: (d: Draft<MoveDoc>) => void, coalesceKey?: string) => void
  /** Push the current doc onto the undo stack (start of a gesture). */
  checkpoint: () => void
  /** Change the doc without a new undo step (during a gesture after checkpoint()). */
  mutate: (recipe: (d: Draft<MoveDoc>) => void) => void
  undo: () => void
  redo: () => void
  replaceDoc: (doc: MoveDoc) => void
  set: (p: Partial<State>) => void
  setView: (v: View) => void
  select: (ids: string[]) => void
  activate: (layoutId: string | null, controls?: string[]) => void
}

const HISTORY_LIMIT = 200
let lastKey: string | undefined
let lastTime = 0
const STORAGE_KEY = 'ableton-move-designer:doc'
const VIEW_KEY = 'ableton-move-designer:view'

function loadDoc(): MoveDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalizeDoc(JSON.parse(raw))
  } catch (e) {
    console.warn('Could not load saved document', e)
  }
  return newDoc()
}

function loadView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    if (raw) {
      const v = JSON.parse(raw)
      if ([v.x, v.y, v.scale].every(Number.isFinite) && v.scale > 0) return v
    }
  } catch {
    /* ignore */
  }
  return { x: 40, y: 40, scale: 0.6 }
}

export const useStore = create<State & Actions>()((setState, get) => ({
  doc: loadDoc(),
  past: [],
  future: [],
  selection: [],
  activeLayoutId: null,
  controlSel: [],
  view: loadView(),
  returnView: null,
  tool: 'select',
  paintColor: '#ff5a1f',
  showLabels: true,
  dialog: null,
  scopeEdit: false,

  commit: (recipe, coalesceKey) => {
    const { doc, past } = get()
    const next = produce(doc, recipe)
    if (next === doc) return
    const now = Date.now()
    const merge = coalesceKey !== undefined && coalesceKey === lastKey && now - lastTime < 1500 && past.length > 0
    lastKey = coalesceKey
    lastTime = now
    if (merge) setState({ doc: next, future: [] })
    else setState({ doc: next, past: [...past.slice(-HISTORY_LIMIT + 1), doc], future: [] })
  },
  checkpoint: () => {
    lastKey = undefined
    const { doc, past } = get()
    setState({ past: [...past.slice(-HISTORY_LIMIT + 1), doc], future: [] })
  },
  mutate: (recipe) => {
    setState({ doc: produce(get().doc, recipe) })
  },
  undo: () => {
    lastKey = undefined
    const { doc, past, future } = get()
    if (!past.length) return
    // Skip no-op checkpoints (e.g. a click that did not move anything).
    let i = past.length - 1
    while (i > 0 && past[i] === doc) i--
    if (past[i] === doc) return setState({ past: [] })
    setState({ doc: past[i], past: past.slice(0, i), future: [doc, ...future] })
    sanitizeSelection()
  },
  redo: () => {
    lastKey = undefined
    const { doc, past, future } = get()
    if (!future.length) return
    setState({ doc: future[0], past: [...past, doc], future: future.slice(1) })
    sanitizeSelection()
  },
  replaceDoc: (doc) => {
    get().commit(() => doc as Draft<MoveDoc>)
    setState({ selection: [], activeLayoutId: null, controlSel: [] })
  },
  set: (p) => setState(p),
  setView: (view) => {
    // A NaN or infinite view would make every later zoom/pan a no-op.
    if ([view.x, view.y, view.scale].every(Number.isFinite) && view.scale > 0) setState({ view })
  },
  select: (ids) => setState({ selection: ids }),
  activate: (layoutId, controls = []) =>
    setState({ activeLayoutId: layoutId, controlSel: layoutId ? controls : [], scopeEdit: layoutId ? get().scopeEdit : false }),
}))

function sanitizeSelection() {
  const s = useStore.getState()
  const ids = new Set(s.doc.items.map((i) => i.id))
  useStore.setState({
    selection: s.selection.filter((id) => ids.has(id)),
    activeLayoutId: s.activeLayoutId && ids.has(s.activeLayoutId) ? s.activeLayoutId : null,
  })
}

// ---- helpers -------------------------------------------------------------

export function findItem<T extends BoardItem = BoardItem>(doc: MoveDoc | Draft<MoveDoc>, id: string): T | undefined {
  return doc.items.find((i) => i.id === id) as T | undefined
}

export function findLayout(doc: MoveDoc | Draft<MoveDoc>, id: string | null): LayoutItem | undefined {
  if (!id) return undefined
  const it = doc.items.find((i) => i.id === id)
  return it && it.type === 'layout' ? (it as LayoutItem) : undefined
}

/** A layout or standalone screen item, by id. */
export function findScreenHost(doc: MoveDoc | Draft<MoveDoc>, id: string | null): ScreenHost | undefined {
  if (!id) return undefined
  const it = doc.items.find((i) => i.id === id)
  return it && (it.type === 'layout' || it.type === 'screen') ? (it as ScreenHost) : undefined
}

// ---- autosave ------------------------------------------------------------

let saveTimer: number | undefined
let lastSavedDoc: MoveDoc | null = null
let lastSavedView: View | null = null
useStore.subscribe((s) => {
  if (s.doc === lastSavedDoc && s.view === lastSavedView) return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const { doc, view } = useStore.getState()
    try {
      if (doc !== lastSavedDoc) localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
      if (view !== lastSavedView) localStorage.setItem(VIEW_KEY, JSON.stringify(view))
      lastSavedDoc = doc
      lastSavedView = view
    } catch (e) {
      console.error('Autosave failed', e)
    }
  }, 250)
})
window.addEventListener('beforeunload', () => {
  const { doc, view } = useStore.getState()
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
    localStorage.setItem(VIEW_KEY, JSON.stringify(view))
  } catch {
    /* ignore */
  }
})

if (import.meta.env.DEV) (window as unknown as { __amd: typeof useStore }).__amd = useStore

// In dev, a hot update to this module (or the model it imports) would create a
// second store next to the old one. Reload the page instead.
if (import.meta.hot) import.meta.hot.accept(() => location.reload())
