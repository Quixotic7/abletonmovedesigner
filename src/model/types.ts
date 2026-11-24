// Document model. This is exactly what gets autosaved and exported as JSON.
//
// MoveDoc
//  └─ items: BoardItem[]          (whiteboard contents, back-to-front order)
//       ├─ LayoutItem             one control layout for the Move
//       │    ├─ scope             control ids this layout covers
//       │    ├─ controls[id]      per-control metadata + LED state
//       │    └─ screen            128x64 1-bit bitmap (base64)
//       ├─ NoteItem               sticky note
//       └─ GroupItem              titled frame; contains whatever lies inside it

import { ALL_CONTROL_IDS } from './hardware'
import { emptyScreen } from '../lib/bitmap'

export const DOC_FORMAT = 'ableton-move-designer'
export const DOC_VERSION = 4

export interface ControlMeta {
  label: string
  description: string
  /** What the control does in this layout, in a sentence. */
  function: string
  /** Quick click / tap (encoders: turn). */
  click: string
  /** Press and hold (encoders: touch). */
  hold: string
  doubleClick: string
  /** Shift + press (encoders: Shift + turn). */
  shift: string
  /** Encoders, volume, wheel only. */
  turn: string
  touch: string
  shiftTurn: string
}

export const META_FIELDS: (keyof ControlMeta)[] = [
  'label',
  'description',
  'function',
  'click',
  'hold',
  'doubleClick',
  'shift',
  'turn',
  'touch',
  'shiftTurn',
]

/**
 * LED state. RGB controls use `color` ('#rrggbb', or null/absent for off).
 * White-LED controls use `brightness` 0..1 (0/absent = off).
 */
export interface LedState {
  color?: string | null
  brightness?: number
}

export interface ControlState {
  meta?: Partial<ControlMeta>
  led?: LedState
}

interface ItemBase {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutItem extends ItemBase {
  type: 'layout'
  name: string
  description: string
  /** Control ids (see hardware.ts) that this layout covers. */
  scope: string[]
  /** Keyed by control id. Absent = untouched. */
  controls: Record<string, ControlState>
  /**
   * 128x64 1-bit screen, 1024 bytes base64: row-major, 16 bytes per row, MSB =
   * leftmost pixel. Always the flattened first frame of `screenFrames`.
   */
  screen: string
  /** Editable screen: animation frames, each with layers. Absent = just `screen`. */
  screenFrames?: ScreenFrame[]
}

/** A raster layer: 1-bit pixels with 1-bit transparency, drawn at an offset. */
export interface RasterLayer {
  id: string
  type: 'raster'
  name: string
  visible: boolean
  /** Offset of the layer's 128x64 pixel grid on the screen. */
  x: number
  y: number
  /** Pixel values (1 = white), same packing as `screen`. */
  data: string
  /** Opaque pixels (1 = opaque), same packing. */
  alpha: string
}

/** An editable text layer. */
export interface TextLayer {
  id: string
  type: 'text'
  name: string
  visible: boolean
  x: number
  y: number
  text: string
  /** 'pixel-5x7', 'pixel-3x5', or a CSS font family rendered and thresholded. */
  font: string
  /** Cap height-ish size in pixels (pixel fonts: a multiple of their native height). */
  size: number
  bold: boolean
  /** 1 = white text, 0 = black text. */
  ink: 0 | 1
  /** Draw a box of the opposite colour behind the text. */
  box: boolean
}

export type ScreenLayer = RasterLayer | TextLayer

export interface ScreenFrame {
  id: string
  /** How long the frame shows when the animation plays, in ms. */
  duration: number
  /** Bottom to top. */
  layers: ScreenLayer[]
  /** Flattened frame, same packing as `screen` (handy for firmware export). */
  image: string
}

export interface NoteItem extends ItemBase {
  type: 'note'
  text: string
  color: string
}

export interface GroupItem extends ItemBase {
  type: 'group'
  title: string
  color: string
}

/** A standalone Move screen on the board (no surrounding device). */
export interface ScreenItem extends ItemBase {
  type: 'screen'
  name: string
  description: string
  /** Flattened first frame, same packing as LayoutItem.screen. */
  screen: string
  screenFrames?: ScreenFrame[]
}

/** Anything that owns an editable screen. */
export type ScreenHost = LayoutItem | ScreenItem

export type BoardItem = LayoutItem | NoteItem | GroupItem | ScreenItem

export interface MoveDoc {
  format: typeof DOC_FORMAT
  version: number
  name: string
  items: BoardItem[]
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export const LAYOUT_W = 1048
export const LAYOUT_H = 616

export function newLayout(x: number, y: number, name = 'New layout', scope: string[] = ALL_CONTROL_IDS): LayoutItem {
  return {
    type: 'layout',
    id: uid(),
    x,
    y,
    w: LAYOUT_W,
    h: LAYOUT_H,
    name,
    description: '',
    scope: [...scope],
    controls: {},
    screen: emptyScreen(),
  }
}

export const NOTE_COLORS = ['#ffe58a', '#ffb3a7', '#b7f0b1', '#a9d8ff', '#e0c3ff', '#f2f2f2']
export const GROUP_COLORS = ['#6c8cff', '#ff8a3d', '#3ccf91', '#d36cff', '#9aa0aa']

export function newNote(x: number, y: number, text = ''): NoteItem {
  return { type: 'note', id: uid(), x, y, w: 320, h: 220, text, color: NOTE_COLORS[0] }
}

export function newGroup(x: number, y: number, w = 1400, h = 900, title = 'Group'): GroupItem {
  return { type: 'group', id: uid(), x, y, w, h, title, color: GROUP_COLORS[0] }
}

export const SCREEN_ITEM_W = 560
export const SCREEN_ITEM_H = 340

export function newScreenItem(x: number, y: number, name = 'Screen'): ScreenItem {
  return { type: 'screen', id: uid(), x, y, w: SCREEN_ITEM_W, h: SCREEN_ITEM_H, name, description: '', screen: emptyScreen() }
}

export function newDoc(): MoveDoc {
  const global = newLayout(80, 120, 'Global shortcuts')
  global.description = 'Every control, default mode.'
  const note = newNote(1180, 120, 'Welcome! Double-click a layout to edit it.\nMiddle-drag or Space-drag to pan, wheel to zoom.')
  return { format: DOC_FORMAT, version: DOC_VERSION, name: 'Untitled', items: [global, note] }
}

/** The step icons the model had before version 4 (it lacked steps 4, 12 and 13). */
const STEP_ICONS_V3 = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16].map((n) => `stepicon-${n}`)
const STEP_ICONS_V4 = [4, 12, 13].map((n) => `stepicon-${n}`)

/**
 * Controls added to the hardware model after a document was saved join a
 * layout's scope when the layout covered the whole set they belong to, so
 * "all encoders" or "all step icons" still means all of them.
 *
 * Version 2 added the encoder LEDs (`knobled-N`): layouts that covered all
 * eight encoders get the LEDs.
 * Version 4 added the step icons under steps 4, 12 and 13: layouts that
 * covered all 13 earlier step icons get the three new ones.
 */
function migrateScope(scope: string[], version: number): string[] {
  const has = new Set(scope)
  let grew = false
  if (version < 2) {
    const knobs = Array.from({ length: 8 }, (_, i) => `knob-${i + 1}`)
    if (knobs.every((k) => has.has(k))) {
      knobs.forEach((_, i) => has.add(`knobled-${i + 1}`))
      grew = true
    }
  }
  if (version < 4 && STEP_ICONS_V3.every((id) => has.has(id))) {
    STEP_ICONS_V4.forEach((id) => has.add(id))
    grew = true
  }
  return grew ? ALL_CONTROL_IDS.filter((id) => has.has(id)) : scope
}

/** Validate / normalise an imported or stored document. Throws on garbage. */
export function normalizeDoc(raw: unknown): MoveDoc {
  if (!raw || typeof raw !== 'object') throw new Error('Not a JSON object')
  const d = raw as Partial<MoveDoc>
  if (d.format !== DOC_FORMAT) throw new Error('Not an Ableton Move Designer document')
  if (!Array.isArray(d.items)) throw new Error('Document has no items')
  const items: BoardItem[] = []
  for (const it of d.items as BoardItem[]) {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string') continue
    const base = { id: it.id, x: +it.x || 0, y: +it.y || 0, w: +it.w || 100, h: +it.h || 100 }
    if (it.type === 'layout') {
      items.push({
        ...base,
        type: 'layout',
        name: String(it.name ?? ''),
        description: String(it.description ?? ''),
        scope: migrateScope(Array.isArray(it.scope) ? it.scope.filter((s) => typeof s === 'string') : [...ALL_CONTROL_IDS], Number(d.version) || 1),
        controls: it.controls && typeof it.controls === 'object' ? it.controls : {},
        screen: typeof it.screen === 'string' && it.screen.length > 0 ? it.screen : emptyScreen(),
        ...(Array.isArray(it.screenFrames) && it.screenFrames.length ? { screenFrames: it.screenFrames } : {}),
      })
    } else if (it.type === 'screen') {
      items.push({
        ...base,
        type: 'screen',
        name: String(it.name ?? ''),
        description: String(it.description ?? ''),
        screen: typeof it.screen === 'string' && it.screen.length > 0 ? it.screen : emptyScreen(),
        ...(Array.isArray(it.screenFrames) && it.screenFrames.length ? { screenFrames: it.screenFrames } : {}),
      })
    } else if (it.type === 'note') {
      items.push({ ...base, type: 'note', text: String(it.text ?? ''), color: String(it.color ?? NOTE_COLORS[0]) })
    } else if (it.type === 'group') {
      items.push({ ...base, type: 'group', title: String(it.title ?? ''), color: String(it.color ?? GROUP_COLORS[0]) })
    }
  }
  return { format: DOC_FORMAT, version: DOC_VERSION, name: String(d.name ?? 'Untitled'), items }
}
