import type { ScreenFrame } from '../../model/types'
import * as S from '../../lib/screen'
import { screenDataUrl } from '../../lib/bitmap'

interface Props {
  frames: ScreenFrame[]
  index: number
  setIndex: (i: number) => void
  saveFrames: (fs: ScreenFrame[]) => void
  playing: boolean
  setPlaying: (p: boolean) => void
  onion: boolean
  setOnion: (o: boolean) => void
  setDuration: (ms: number) => void
}

export function FramesStrip({ frames, index, setIndex, saveFrames, playing, setPlaying, onion, setOnion, setDuration }: Props) {
  const frame = frames[index]
  const insertAt = (f: ScreenFrame) => {
    const fs = [...frames.slice(0, index + 1), f, ...frames.slice(index + 1)]
    saveFrames(fs)
    setIndex(index + 1)
  }
  const swap = (d: number) => {
    const j = index + d
    if (j < 0 || j >= frames.length) return
    const fs = [...frames]
    ;[fs[index], fs[j]] = [fs[j], fs[index]]
    saveFrames(fs)
    setIndex(j)
  }
  const total = frames.reduce((a, f) => a + f.duration, 0)
  return (
    <div className="se-frames" onPointerDown={(e) => e.stopPropagation()}>
      <div className="se-frame-controls">
        <button className={playing ? 'btn small on' : 'btn small'} disabled={frames.length < 2} onClick={() => setPlaying(!playing)} title="Play / stop (Enter)">
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        <label className="check" title="Show the previous frame in red">
          <input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} /> Onion skin
        </label>
        <label className="se-field inline">
          Frame {index + 1} ms
          <input type="number" min={16} step={10} value={frame.duration} onChange={(e) => setDuration(Math.max(16, +e.target.value || 100))} />
        </label>
        <span className="muted small">
          {frames.length} frame{frames.length === 1 ? '' : 's'} · {(total / 1000).toFixed(2)} s
        </span>
        <span className="spacer" />
        <button className="btn small" onClick={() => insertAt(S.cloneFrame(frame))} title="Duplicate this frame">
          + Duplicate
        </button>
        <button className="btn small" onClick={() => insertAt(S.newFrame())} title="New blank frame">
          + Blank
        </button>
        <button className="btn small" disabled={index === 0} onClick={() => swap(-1)} title="Move frame left">
          ←
        </button>
        <button className="btn small" disabled={index >= frames.length - 1} onClick={() => swap(1)} title="Move frame right">
          →
        </button>
        <button
          className="btn small"
          disabled={frames.length <= 1}
          onClick={() => {
            saveFrames(frames.filter((_, i) => i !== index))
            setIndex(Math.max(0, index - 1))
          }}
          title="Delete this frame"
        >
          Delete
        </button>
      </div>
      <div className="se-frame-list">
        {frames.map((f, i) => (
          <button key={f.id} className={i === index ? 'se-frame on' : 'se-frame'} onClick={() => setIndex(i)} title={`Frame ${i + 1} · ${f.duration} ms`}>
            <img src={screenDataUrl(f.image)} alt="" />
            <span>{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
