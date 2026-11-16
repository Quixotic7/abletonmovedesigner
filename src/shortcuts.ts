import { useEffect } from 'react'
import { useStore } from './store'
import * as cmd from './commands'
import { parseClip, type PasteMode } from './model/ops'
import { leaveLayout, zoomCenter, zoomToFit, zoomToSelection } from './viewport'

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl'

function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"]')
}

/** Global keyboard shortcuts and clipboard events. Dialogs handle their own keys. */
export function useShortcuts() {
  useEffect(() => {
    let pendingMode: PasteMode | null = null
    let pendingTimer = 0
    let keyClip: ReturnType<typeof cmd.copy> = null

    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (s.dialog || typing(e.target)) return
      const mod = isMac ? e.metaKey : e.ctrlKey
      const k = e.key.toLowerCase()

      if (mod && k === 'z') {
        e.preventDefault()
        return e.shiftKey ? s.redo() : s.undo()
      }
      if (mod && k === 'y') {
        e.preventDefault()
        return s.redo()
      }
      if (mod && k === 'a') {
        e.preventDefault()
        return cmd.selectAll()
      }
      if (mod && k === 'd') {
        e.preventDefault()
        return cmd.duplicate()
      }
      if (mod && k === 'g') {
        e.preventDefault()
        return cmd.addGroup()
      }
      if (mod && k === 's') {
        e.preventDefault()
        return cmd.exportJson()
      }
      if (mod && k === 'v') {
        // Plain paste normally arrives as a paste event (which can carry data
        // from another tab). Paste-only-metadata (Shift) / only-colours (Alt),
        // and any paste whose event never fires, fall back to the internal clipboard.
        if (e.shiftKey || e.altKey) e.preventDefault()
        pendingMode = e.shiftKey ? 'meta' : e.altKey ? 'led' : 'all'
        window.clearTimeout(pendingTimer)
        pendingTimer = window.setTimeout(() => {
          if (pendingMode) cmd.paste(cmd.getClip(), pendingMode)
          pendingMode = null
        }, 40)
        return
      }
      if (mod && (k === 'c' || k === 'x') && !hasTextSelection()) {
        // Copy / cut right away (the copy event, if the browser fires one, then
        // only mirrors the result to the system clipboard).
        keyClip = k === 'c' ? cmd.copy() : cmd.cut()
        window.setTimeout(() => (keyClip = null), 100)
        return
      }
      if (mod && (k === '=' || k === '+')) {
        e.preventDefault()
        return zoomCenter(1.25)
      }
      if (mod && k === '-') {
        e.preventDefault()
        return zoomCenter(0.8)
      }
      if (mod && k === '0') {
        e.preventDefault()
        return s.setView({ ...s.view, scale: 1 })
      }
      if (mod) return

      switch (e.key) {
        case 'Escape':
          if (s.tool === 'paint') return s.set({ tool: 'select' })
          if (s.scopeEdit) return s.set({ scopeEdit: false })
          if (s.activeLayoutId) return leaveLayout()
          return s.select([])
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          return cmd.deleteSelection()
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!s.selection.length || s.controlSel.length) return
          e.preventDefault()
          const step = e.shiftKey ? 10 : 1
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
          return cmd.nudge(dx, dy)
        }
        case 'Enter':
          if (s.activeLayoutId && s.controlSel.length) {
            e.preventDefault()
            const ids = s.controlSel
            return s.set({
              dialog: ids.length === 1 && ids[0] === 'screen' ? { kind: 'screen', layoutId: s.activeLayoutId } : { kind: 'meta', layoutId: s.activeLayoutId, controlIds: ids },
            })
          }
          return
      }
      if (e.shiftKey && e.code === 'Digit1') return zoomToFit()
      if (e.shiftKey && e.code === 'Digit2') return zoomToSelection()
      if (e.altKey || e.shiftKey) return
      switch (k) {
        case 'v':
          return s.set({ tool: 'select' })
        case 'b':
        case 'p':
          return s.set({ tool: s.tool === 'paint' ? 'select' : 'paint' })
        case 'n':
          return cmd.addNote()
        case 'l':
          return cmd.addLayout()
        case 't':
          return s.set({ showLabels: !s.showLabels })
        case '?':
          return s.set({ dialog: { kind: 'help' } })
      }
      if (e.key === '?') s.set({ dialog: { kind: 'help' } })
    }

    const onClipboardOut = (action: () => ReturnType<typeof cmd.copy>) => (e: ClipboardEvent) => {
      const handled = keyClip
      keyClip = null
      if (useStore.getState().dialog || typing(e.target) || hasTextSelection()) return
      const clip = handled ?? action()
      if (clip) {
        e.preventDefault()
        e.clipboardData?.setData('text/plain', JSON.stringify(clip))
      }
    }
    const onCopy = onClipboardOut(cmd.copy)
    const onCut = onClipboardOut(cmd.cut)
    const onPaste = (e: ClipboardEvent) => {
      if (useStore.getState().dialog || typing(e.target)) return
      e.preventDefault()
      const fromSystem = parseClip(e.clipboardData?.getData('text/plain') ?? '')
      if (pendingMode === null && !fromSystem && !cmd.getClip()) return
      const mode = pendingMode ?? 'all'
      pendingMode = null
      window.clearTimeout(pendingTimer)
      cmd.paste(fromSystem ?? cmd.getClip(), mode)
    }

    window.addEventListener('keydown', onKey)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [])
}

function hasTextSelection() {
  const sel = window.getSelection()
  return !!sel && !sel.isCollapsed && sel.toString().length > 0
}
