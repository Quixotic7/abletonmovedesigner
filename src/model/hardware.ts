// Geometry and identity of every control on the Ableton Move top panel.
//
// Coordinates are in "device units": the body is DEVICE_W x DEVICE_H and the
// positions were measured from Ableton's official "Move's Controls" diagram in
// the Move manual (https://www.ableton.com/en/move/manual/), so proportions and
// spacing match the real hardware.

export const DEVICE_W = 1008
export const DEVICE_H = 470

export type ControlKind =
  | 'pad'
  | 'step'
  | 'knob'
  | 'volume'
  | 'wheel'
  | 'track'
  | 'button'
  | 'stepicon'
  | 'knobled'
  | 'screen'

/** What kind of light a control has. */
export type LedKind = 'rgb' | 'white' | 'none' | 'screen'

export type Shape =
  | { type: 'rect'; x: number; y: number; w: number; h: number; r: number }
  | { type: 'circle'; cx: number; cy: number; r: number }

export type ScopeGroupId =
  | 'pads'
  | 'steps'
  | 'stepicons'
  | 'tracks'
  | 'knobs'
  | 'knobleds'
  | 'volume'
  | 'wheel'
  | 'screen'
  | 'transport'
  | 'left'
  | 'right'
  | 'shift'
  | 'arrows'
  | 'power'

export interface MidiInfo {
  /** Note number sent on press (pads, steps). */
  note?: number
  /** CC number (buttons send 127/0, encoders send relative values). */
  cc?: number
  /** Note sent when an encoder / the wheel is touched. */
  touchNote?: number
  /** CC sent when the wheel is clicked. */
  clickCc?: number
  /** CC that sets this light when it has no input of its own (encoder LEDs, step icons). */
  ledCc?: number
}

export interface ControlDef {
  id: string
  kind: ControlKind
  /** Hardware name, e.g. "Pad 1", "Capture". */
  name: string
  group: ScopeGroupId
  shape: Shape
  led: LedKind
  midi?: MidiInfo
  /** Glyph drawn on the button (see MoveSurface). */
  icon?: string
  /** Printed Shift function under a step button. */
  shiftLabel?: string
  shiftIcon?: string
  /** Steps 1, 5, 9, 13 carry a beat marker. */
  beat?: boolean
}

export const SCOPE_GROUPS: { id: ScopeGroupId; name: string }[] = [
  { id: 'pads', name: 'Pads' },
  { id: 'steps', name: 'Step buttons' },
  { id: 'stepicons', name: 'Step icons' },
  { id: 'tracks', name: 'Track buttons' },
  { id: 'knobs', name: 'Encoders 1-8' },
  { id: 'knobleds', name: 'Encoder LEDs' },
  { id: 'volume', name: 'Volume' },
  { id: 'wheel', name: 'Jog wheel' },
  { id: 'screen', name: 'Screen' },
  { id: 'transport', name: 'Play / Record' },
  { id: 'left', name: 'Back / Menu' },
  { id: 'right', name: 'Right-side buttons' },
  { id: 'shift', name: 'Shift' },
  { id: 'arrows', name: 'Arrows / Octave' },
  { id: 'power', name: 'Power' },
]

const circle = (cx: number, cy: number, r: number): Shape => ({ type: 'circle', cx, cy, r })

// The icon printed under each of the 16 step buttons: [label, glyph]. Ableton's
// manual gives no function for the icons under steps 4, 12 and 13, so those are
// named by their shape. (Schwung opens its Tools menu from the step 13 star.)
const STEP_SHIFT: Record<number, [string, string]> = {
  0: ['Set Overview', 'page'],
  1: ['Setup', 'gear'],
  2: ['Workflow Settings', 'nodes'],
  3: ['Cylinder, undocumented', 'cylinder'],
  4: ['Tempo', 'clock'],
  5: ['Metronome', 'metro'],
  6: ['Groove', 'wave'],
  7: ['Layout', 'grid'],
  8: ['Keys & Scales', 'note'],
  9: ['Full Velocity', 'bars'],
  10: ['Arp / Repeat', 'arp'],
  11: ['Merge, undocumented', 'merge'],
  12: ['Star, undocumented', 'star'],
  13: ['New Clip', 'newclip'],
  14: ['Double Loop', 'double'],
  15: ['Quantize', 'quant'],
}

function build(): ControlDef[] {
  const out: ControlDef[] = []

  out.push({
    id: 'screen',
    kind: 'screen',
    name: 'Screen',
    group: 'screen',
    shape: { type: 'rect', x: 24, y: 29, w: 108, h: 54, r: 1 },
    led: 'screen',
  })

  for (let i = 0; i < 8; i++) {
    out.push({
      id: `knob-${i + 1}`,
      kind: 'knob',
      name: `Encoder ${i + 1}`,
      group: 'knobs',
      shape: circle(227 + i * 85.2, 46, 19),
      led: 'none',
      midi: { cc: 71 + i, touchNote: i },
    })
  }
  // The small LEDs under each encoder.
  for (let i = 0; i < 8; i++) {
    out.push({
      id: `knobled-${i + 1}`,
      kind: 'knobled',
      name: `Encoder ${i + 1} LED`,
      group: 'knobleds',
      shape: circle(227 + i * 85.2, 84, 5),
      led: 'rgb',
      midi: { ledCc: 71 + i },
    })
  }
  out.push({
    id: 'volume',
    kind: 'volume',
    name: 'Volume',
    group: 'volume',
    shape: circle(961, 53, 23),
    led: 'none',
    midi: { cc: 79, touchNote: 8 },
  })
  out.push({
    id: 'wheel',
    kind: 'wheel',
    name: 'Jog wheel',
    group: 'wheel',
    shape: circle(75, 172, 42),
    led: 'none',
    midi: { cc: 14, clickCc: 3, touchNote: 9 },
  })

  const btn = (
    id: string,
    name: string,
    group: ScopeGroupId,
    cx: number,
    cy: number,
    r: number,
    cc: number | undefined,
    icon: string,
    led: LedKind = 'white',
  ) => out.push({ id, kind: 'button', name, group, shape: circle(cx, cy, r), led, midi: cc === undefined ? undefined : { cc }, icon })

  btn('back', 'Back', 'left', 45, 269, 21, 51, 'back')
  btn('menu', 'Menu', 'left', 104, 269, 21, 50, 'menu')

  // Track buttons, top to bottom: CC 43, 42, 41, 40.
  for (let i = 0; i < 4; i++) {
    out.push({
      id: `track-${i + 1}`,
      kind: 'track',
      name: `Track ${i + 1}`,
      group: 'tracks',
      shape: { type: 'rect', x: 134, y: 140 + i * 64.6 - 25, w: 24, h: 50, r: 12 },
      led: 'rgb',
      midi: { cc: 43 - i },
    })
  }

  // Pads: 4 rows x 8 columns. Row 0 is the top row. MIDI notes start at the
  // bottom-left (68) and run left to right, bottom to top.
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 8; c++) {
      const note = 68 + (3 - r) * 8 + c
      out.push({
        id: `pad-${r + 1}-${c + 1}`,
        kind: 'pad',
        name: `Pad row ${r + 1} col ${c + 1}`,
        group: 'pads',
        shape: { type: 'rect', x: 191 + c * 85.3, y: 114 + r * 64.9, w: 72, h: 52, r: 3 },
        led: 'rgb',
        midi: { note },
      })
    }
  }

  btn('capture', 'Capture', 'right', 903, 139, 21, 52, 'capture')
  btn('sample', 'Sample', 'right', 961, 139, 21, 118, 'sample')
  btn('loop', 'Loop', 'right', 903, 204, 21, 58, 'loop')
  btn('mute', 'Mute', 'right', 961, 204, 21, 88, 'mute')
  btn('delete', 'Delete', 'right', 903, 269, 21, 119, 'delete')
  btn('copy', 'Copy', 'right', 961, 269, 21, 60, 'copy')
  btn('undo', 'Undo', 'right', 903, 334, 21, 56, 'undo')
  btn('shift', 'Shift', 'shift', 961, 334, 21, 49, 'shift')

  btn('play', 'Play', 'transport', 48, 411, 22, 85, 'play', 'rgb')
  btn('record', 'Record', 'transport', 104, 411, 22, 86, 'record', 'rgb')

  for (let i = 0; i < 16; i++) {
    const sh = STEP_SHIFT[i]
    out.push({
      id: `step-${i + 1}`,
      kind: 'step',
      name: `Step ${i + 1}`,
      group: 'steps',
      shape: circle(206 + i * 42.67, 411, 15),
      led: 'rgb',
      midi: { note: 16 + i },
      shiftLabel: sh?.[0],
      shiftIcon: sh?.[1],
      beat: i % 4 === 0,
    })
  }
  // The printed Shift-function icons under the step buttons light up (white).
  // All 16 steps have one.
  for (let i = 0; i < 16; i++) {
    const sh = STEP_SHIFT[i]
    out.push({
      id: `stepicon-${i + 1}`,
      kind: 'stepicon',
      name: `Step ${i + 1} icon (${sh[0]})`,
      group: 'stepicons',
      shape: circle(206 + i * 42.67, 448, 9),
      led: 'white',
      midi: { ledCc: 16 + i },
      shiftLabel: sh[0],
      shiftIcon: sh[1],
    })
  }

  btn('left', 'Left', 'arrows', 895, 411, 15, 62, 'left')
  btn('right', 'Right', 'arrows', 970, 411, 15, 63, 'right')
  btn('up', 'Up (octave +)', 'arrows', 933, 391, 15, 55, 'plus')
  btn('down', 'Down (octave -)', 'arrows', 933, 431, 15, 54, 'minus')

  // The power button lives on the rear panel; it is drawn on the top edge.
  out.push({
    id: 'power',
    kind: 'button',
    name: 'Power (rear)',
    group: 'power',
    shape: { type: 'rect', x: 760, y: -16, w: 34, h: 12, r: 4 },
    led: 'none',
    icon: 'power',
  })

  return out
}

export const CONTROLS: ControlDef[] = build()
export const CONTROL_BY_ID: Record<string, ControlDef> = Object.fromEntries(CONTROLS.map((c) => [c.id, c]))
export const ALL_CONTROL_IDS = CONTROLS.map((c) => c.id)

export function controlsInGroup(g: ScopeGroupId): string[] {
  return CONTROLS.filter((c) => c.group === g).map((c) => c.id)
}

export function shapeBounds(s: Shape) {
  if (s.type === 'rect') return { x: s.x, y: s.y, w: s.w, h: s.h }
  return { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 }
}

export function shapeCenter(s: Shape) {
  if (s.type === 'rect') return { x: s.x + s.w / 2, y: s.y + s.h / 2 }
  return { x: s.cx, y: s.cy }
}

/** Human summary of a scope, e.g. "All controls", "Encoders 1-8 + Volume". */
export function describeScope(scope: string[]): string {
  const set = new Set(scope)
  if (ALL_CONTROL_IDS.every((id) => set.has(id))) return 'All controls'
  if (set.size === 0) return 'Nothing'
  const parts: string[] = []
  let loose = 0
  for (const g of SCOPE_GROUPS) {
    const ids = controlsInGroup(g.id)
    const n = ids.filter((id) => set.has(id)).length
    if (n === ids.length) parts.push(g.name)
    else loose += n
  }
  if (loose) parts.push(`${loose} other${loose === 1 ? '' : 's'}`)
  return parts.join(' + ')
}

/** Controls sorted in reading order (top-to-bottom, left-to-right). Used for paste mapping. */
export function readingOrder(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ca = shapeCenter(CONTROL_BY_ID[a].shape)
    const cb = shapeCenter(CONTROL_BY_ID[b].shape)
    if (Math.abs(ca.y - cb.y) > 8) return ca.y - cb.y
    return ca.x - cb.x
  })
}
