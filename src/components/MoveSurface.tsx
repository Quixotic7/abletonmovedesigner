import { memo, type ReactNode } from 'react'
import { CONTROLS, DEVICE_H, DEVICE_W, shapeBounds, type ControlDef } from '../model/hardware'
import type { ControlState, LayoutItem } from '../model/types'
import { ledCss, luminance } from '../model/ops'
import { screenDataUrl } from '../lib/bitmap'

/** Device drawing, in device units. The SVG's top edge leaves room for the rear power button. */
export const SURFACE_TOP = -22
export const SURFACE_H = DEVICE_H - SURFACE_TOP

const OFF_PAD = '#3a3b40'
const PRINT = '#8d8f96'
const SEL = '#4da3ff'

interface Props {
  layout: LayoutItem
  selected?: string[]
  showLabels: boolean
  scopeEdit?: boolean
}

function MoveSurfaceImpl({ layout, selected, showLabels, scopeEdit }: Props) {
  const scope = new Set(layout.scope)
  const sel = new Set(selected ?? [])
  return (
    <svg
      className="move-surface"
      width={DEVICE_W}
      height={SURFACE_H}
      viewBox={`0 ${SURFACE_TOP} ${DEVICE_W} ${SURFACE_H}`}
      data-layout-body={layout.id}
    >
      <rect x={0} y={0} width={DEVICE_W} height={DEVICE_H} rx={14} fill="#26272b" stroke="#45464c" strokeWidth={2} />
      {/* decorative: the microphone hole */}
      <circle cx={891} cy={45} r={2.5} fill="#111" stroke={PRINT} strokeWidth={0.8} />
      {CONTROLS.map((def) => (
        <Control
          key={def.id}
          def={def}
          st={layout.controls[def.id]}
          inScope={scope.has(def.id)}
          selected={sel.has(def.id)}
          showLabels={showLabels}
          scopeEdit={!!scopeEdit}
          screen={def.kind === 'screen' ? layout.screen : undefined}
        />
      ))}
    </svg>
  )
}

export const MoveSurface = memo(MoveSurfaceImpl)

function hasMeta(st?: ControlState) {
  return !!st?.meta && Object.entries(st.meta).some(([k, v]) => k !== 'label' && typeof v === 'string' && v.trim())
}

function tooltip(def: ControlDef, st?: ControlState) {
  const m = st?.meta ?? {}
  const lines = [m.label ? `${m.label} (${def.name})` : def.name]
  const add = (k: string, v?: string) => v && v.trim() && lines.push(`${k}: ${v}`)
  add('Function', m.function)
  add('Click', m.click)
  add('Hold', m.hold)
  add('Double-click', m.doubleClick)
  add('Shift', m.shift)
  add('Turn', m.turn)
  add('Touch', m.touch)
  add('Shift+turn', m.shiftTurn)
  add('Notes', m.description)
  if (def.shiftLabel) lines.push(`(printed: Shift + ${def.shiftLabel})`)
  return lines.join('\n')
}

interface CtlProps {
  def: ControlDef
  st?: ControlState
  inScope: boolean
  selected: boolean
  showLabels: boolean
  scopeEdit: boolean
  screen?: string
}

const Control = memo(function Control({ def, st, inScope, selected, showLabels, scopeEdit, screen }: CtlProps) {
  const lit = ledCss(def, st)
  const label = st?.meta?.label?.trim()
  const s = def.shape
  const b = shapeBounds(s)
  let body: ReactNode
  let labelPos: { x: number; y: number; anchor?: 'middle' | 'start' } | null = null
  let labelInside = false

  switch (def.kind) {
    case 'pad': {
      if (s.type !== 'rect') break
      body = <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} fill={lit ?? OFF_PAD} stroke={lit ? 'none' : '#4a4b51'} />
      labelPos = { x: s.x + s.w / 2, y: s.y + s.h / 2 + 4 }
      labelInside = true
      break
    }
    case 'track': {
      if (s.type !== 'rect') break
      body = <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} fill={lit ?? '#1c1d20'} stroke="#6a6b72" strokeWidth={1.5} />
      if (!lit) body = <>{body}<line x1={s.x + s.w / 2} x2={s.x + s.w / 2} y1={s.y + 12} y2={s.y + s.h - 12} stroke="#9a9ba2" strokeWidth={3} strokeLinecap="round" /></>
      labelPos = { x: s.x - 4, y: s.y + s.h / 2 + 3, anchor: 'start' }
      break
    }
    case 'step': {
      if (s.type !== 'circle') break
      body = (
        <>
          <circle cx={s.cx} cy={s.cy} r={s.r} fill={lit ?? '#1c1d20'} stroke="#6a6b72" strokeWidth={1.5} />
          {!lit && <circle cx={s.cx} cy={s.cy} r={3.2} fill="#8a8b92" />}
          {def.beat && <line x1={s.cx - 3.5} x2={s.cx + 3.5} y1={s.cy + 8} y2={s.cy + 8} stroke={lit ? 'rgba(0,0,0,.5)' : '#8a8b92'} strokeWidth={1.5} />}
        </>
      )
      labelPos = { x: s.cx, y: s.cy - s.r - 5 }
      break
    }
    case 'stepicon': {
      if (s.type !== 'circle') break
      body = (
        <g transform={`translate(${s.cx} ${s.cy})`}>
          {lit && <circle r={9} fill={lit} opacity={0.18} />}
          {shiftGlyph(def.shiftIcon ?? '', lit ?? undefined)}
        </g>
      )
      labelPos = { x: s.cx, y: s.cy + 19 }
      break
    }
    case 'knob':
    case 'volume': {
      if (s.type !== 'circle') break
      body = (
        <>
          <circle cx={s.cx} cy={s.cy} r={s.r} fill="#17181a" stroke="#5c5d63" strokeWidth={1.5} />
          <circle cx={s.cx} cy={s.cy} r={s.r - 4} fill="none" stroke="#2f3034" strokeWidth={1} />
          <line x1={s.cx} x2={s.cx} y1={s.cy - s.r + 3} y2={s.cy - s.r + 9} stroke="#d0d1d6" strokeWidth={2} strokeLinecap="round" />
        </>
      )
      labelPos = def.kind === 'volume' ? { x: s.cx, y: s.cy + s.r + 14 } : { x: s.cx, y: 101 }
      break
    }
    case 'knobled': {
      if (s.type !== 'circle') break
      body = (
        <>
          {lit && <circle cx={s.cx} cy={s.cy} r={s.r + 3} fill={lit} opacity={0.25} />}
          <circle cx={s.cx} cy={s.cy} r={3.2} fill={lit ?? 'none'} stroke={lit ?? PRINT} strokeWidth={1} />
        </>
      )
      break
    }
    case 'wheel': {
      if (s.type !== 'circle') break
      body = (
        <>
          <circle cx={s.cx} cy={s.cy} r={s.r} fill="#1c1d20" stroke="#5c5d63" strokeWidth={1.5} />
          <circle cx={s.cx} cy={s.cy} r={s.r - 8} fill="none" stroke="#2f3034" strokeWidth={1} />
        </>
      )
      labelPos = { x: s.cx, y: s.cy + s.r + 14 }
      break
    }
    case 'screen': {
      if (s.type !== 'rect') break
      body = (
        <>
          <rect x={s.x - 3} y={s.y - 3} width={s.w + 6} height={s.h + 6} rx={3} fill="#0a0a0a" stroke="#5c5d63" />
          {screen && (
            <image href={screenDataUrl(screen)} x={s.x} y={s.y} width={s.w} height={s.h} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} />
          )}
        </>
      )
      labelPos = { x: s.x + s.w / 2, y: s.y + s.h + 17 }
      break
    }
    case 'button': {
      if (def.id === 'power') {
        if (s.type !== 'rect') break
        body = (
          <>
            <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} fill="#e8c21c" stroke="#8a7410" />
            <text x={s.x + s.w + 6} y={s.y + 10} className="print small">power (rear)</text>
          </>
        )
        labelPos = { x: s.x - 6, y: s.y + 10, anchor: 'start' }
        break
      }
      if (s.type !== 'circle') break
      const rgb = def.led === 'rgb'
      const ink = rgb ? (lit && luminance(lit) > 0.6 ? '#111' : '#e6e7ea') : lit ?? '#7d7e85'
      const isShift = def.id === 'shift'
      body = (
        <>
          <circle
            cx={s.cx}
            cy={s.cy}
            r={s.r}
            fill={rgb && lit ? lit : isShift ? '#3a2a26' : '#1c1d20'}
            stroke={!rgb && lit ? lit : isShift ? '#d98a73' : '#6a6b72'}
            strokeWidth={1.5}
          />
          <g transform={`translate(${s.cx} ${s.cy})`} stroke={ink} fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            {buttonGlyph(def.icon ?? '', ink, s.r)}
          </g>
        </>
      )
      labelPos = { x: s.cx, y: s.cy + s.r + 11 }
      break
    }
  }

  const pad = 4
  const cls = ['ctl', inScope ? '' : 'out-of-scope', scopeEdit ? 'scope-edit' : ''].join(' ')
  return (
    <g className={cls} data-control-id={def.id}>
      <title>{tooltip(def, st)}</title>
      {/* generous invisible hit area */}
      <rect x={b.x - 2} y={b.y - 2} width={b.w + 4} height={b.h + 4} fill="transparent" />
      {body}
      {hasMeta(st) && inScope && <circle cx={b.x + b.w - 1} cy={b.y + 1} r={4} fill="#ffb02e" stroke="#26272b" strokeWidth={1.5} />}
      {showLabels && label && labelPos && (
        <text
          x={labelPos.x}
          y={labelPos.y}
          textAnchor={labelPos.anchor === 'start' ? 'end' : 'middle'}
          className={labelInside ? 'ctl-label inside' : 'ctl-label'}
          fill={labelInside ? (lit && luminance(lit) > 0.55 ? '#111' : '#f2f2f2') : '#e8e8ea'}
        >
          {label.length > 14 ? label.slice(0, 13) + '…' : label}
        </text>
      )}
      {selected && (
        <rect
          x={b.x - pad}
          y={b.y - pad}
          width={b.w + pad * 2}
          height={b.h + pad * 2}
          rx={def.shape.type === 'circle' ? b.w / 2 + pad : 6}
          fill="none"
          stroke={SEL}
          strokeWidth={3}
          pointerEvents="none"
        />
      )}
      {scopeEdit && inScope && (
        <rect x={b.x - 2} y={b.y - 2} width={b.w + 4} height={b.h + 4} rx={4} fill="rgba(77,163,255,.12)" stroke={SEL} strokeDasharray="4 3" pointerEvents="none" />
      )}
    </g>
  )
})

function buttonGlyph(icon: string, ink: string, r: number): ReactNode {
  const k = r / 21
  const sc = (n: number) => n * k
  switch (icon) {
    case 'back':
    case 'left':
      return <path d={`M${sc(3)} ${sc(-6)} L${sc(-3)} 0 L${sc(3)} ${sc(6)}`} />
    case 'right':
      return <path d={`M${sc(-3)} ${sc(-6)} L${sc(3)} 0 L${sc(-3)} ${sc(6)}`} />
    case 'menu':
      return <path d="M-7 -5 H7 M-7 0 H7 M-7 5 H7" />
    case 'capture':
      return <path d="M-7 -3 V-7 H-3 M3 -7 H7 V-3 M7 3 V7 H3 M-3 7 H-7 V3" />
    case 'sample':
      return <circle r={4} fill={ink} stroke="none" />
    case 'loop':
      return <path d="M-2 5 H-4 A5 5 0 0 1 -4 -5 H4 A5 5 0 0 1 4 5 H1 M3 3 L1 5 L3 7" />
    case 'mute':
      return <path d="M-6 6 V-6 L0 2 L6 -6 V6" />
    case 'delete':
      return <path d="M-6 -6 L6 6 M6 -6 L-6 6" />
    case 'copy':
      return <path d="M-6 -1 V6 H1 M-2 -6 H6 V2 H-2 Z" />
    case 'undo':
      return <path d="M-7 -1 H3 A4.5 4.5 0 0 1 3 8 H-2 M-3 -5 L-7 -1 L-3 3" />
    case 'shift':
      return (
        <>
          <circle cx={-6} r={1.6} fill={ink} stroke="none" />
          <circle cx={0} r={1.6} fill={ink} stroke="none" />
          <circle cx={6} r={1.6} fill={ink} stroke="none" />
        </>
      )
    case 'play':
      return <path d="M-5 -8 L8 0 L-5 8 Z" />
    case 'record':
      return <circle r={8} />
    case 'plus':
      return <path d="M-5 0 H5 M0 -5 V5" />
    case 'minus':
      return <path d="M-5 0 H5" />
  }
  return null
}

function shiftGlyph(icon: string, ink = PRINT): ReactNode {
  const PRINT_INK = ink
  const p = { stroke: PRINT_INK, fill: 'none', strokeWidth: ink === PRINT ? 1 : 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (icon) {
    case 'page':
      return <path {...p} d="M-4 -5 H2 L4 -3 V5 H-4 Z" />
    case 'gear':
      return (
        <g {...p}>
          <path d="M0 -5.5 L4.8 -2.75 V2.75 L0 5.5 L-4.8 2.75 V-2.75 Z" />
          <circle r={1.8} />
        </g>
      )
    case 'nodes':
      return (
        <g {...p}>
          <circle cx={-3.5} cy={-3} r={1.6} />
          <circle cx={3.5} cy={-1} r={1.6} />
          <circle cx={-1} cy={4} r={1.6} />
          <path d="M-2 -2.5 L2 -1.5 M-2.6 -1.6 L-1.4 2.5" />
        </g>
      )
    case 'clock':
      return (
        <g {...p}>
          <circle r={5} />
          <path d="M0 -3 V0 L2 1.5" />
        </g>
      )
    case 'metro':
      return (
        <g {...p}>
          <circle cx={-3.5} r={2.6} />
          <circle cx={3.5} r={2.6} fill={PRINT_INK} />
        </g>
      )
    case 'wave':
      return <path {...p} d="M-6 -2 Q-3 -5 0 -2 T6 -2 M-6 2 Q-3 -1 0 2 T6 2" />
    case 'grid':
      return <path {...p} d="M-5 -4 H5 V4 H-5 Z M-5 0 H5 M0 -4 V4" />
    case 'note':
      return <path {...p} d="M-2 5 A1.8 1.8 0 1 1 -2 4.9 M-0.2 4.5 V-5 L4 -3" />
    case 'bars':
      return <path {...p} d="M-5 -4 H-1 M-5 -1 H2 M-5 2 H5 M-5 5 H5" />
    case 'arp':
      return (
        <g {...p}>
          <circle cx={-4} r={2.4} />
          <path d="M0 -3 Q2 0 0 3 M3 -4.5 Q6 0 3 4.5" />
        </g>
      )
    case 'cylinder':
      return (
        <g {...p}>
          <ellipse cy={-3.4} rx={3.8} ry={1.7} />
          <path d="M-3.8 -3.4 V5 M3.8 -3.4 V5" />
        </g>
      )
    case 'merge':
      return <path {...p} d="M-5.5 -4.5 H-1.5 L5.5 -1.2 M-5.5 -1.5 H-1.5 L5.5 -0.4 M-5.5 1.5 H-1.5 L5.5 0.4 M-5.5 4.5 H-1.5 L5.5 1.2" />
    case 'star':
      return <path {...p} d="M0 -6 Q0.9 -0.9 6 0 Q0.9 0.9 0 6 Q-0.9 0.9 -6 0 Q-0.9 -0.9 0 -6 Z" />
    case 'newclip':
      return <path {...p} d="M-6 -3 H-2 M-4 -5 V-1 M-2 1 H5 V5 H-2 Z" />
    case 'double':
      return <path {...p} d="M-5 -1 H1 V5 H-5 Z M-2 -1 V-4 H4 V2 H1" />
    case 'quant':
      return <path {...p} d="M-5 -5 V5 M-3 -4 H1 M-3 -1 H4 M-3 2 H2 M-3 5 H5" />
  }
  return null
}
