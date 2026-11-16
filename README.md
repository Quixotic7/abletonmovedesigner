# Ableton Move Designer

A browser tool for planning control layouts for the Ableton Move: what every pad,
step button, encoder, button and the screen does in each mode of your firmware.

Layouts sit on a Figma-style whiteboard as full drawings of the Move. Zoom in and
edit them in place, side by side, without opening a separate editor.

The drawing matches Ableton's official *Move's Controls* diagram from the
[Move manual](https://www.ableton.com/en/move/manual/): positions, spacing and
proportions are measured from it (`src/model/hardware.ts`).

## Run it

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

Production build (static files in `dist/`, which work from any static host or a sub-path):

```bash
npm run build
npm run preview
```

There is no backend. The document autosaves to the browser's localStorage.
**Export** (Cmd/Ctrl+S) writes the whole document to a `.movedesign.json` file, and
**Import** loads one. Import can be undone.

## Using it

- **Board.** Layouts, sticky notes and groups (titled frames). Drag a layout by its
  title bar, a note anywhere, a group by its title tab. Anything inside a group's
  frame moves with the group. Notes and groups resize from the bottom-right corner.
- **Edit a layout in place.** Click any control on a layout to select it; that
  layout becomes the active one, outlined in orange, and the inspector opens on the
  right. Double-click a layout's title to zoom to it. Esc, the breadcrumb or
  **← Back** returns you to the board and restores your previous view.
- **Control metadata.** Double-click a control, or press Enter with controls
  selected. The fields are Label, Function, Quick click, Hold, Double-click,
  Shift + press and Description. Encoders, Volume and the jog wheel also get Turn,
  Touch and Shift + turn. With several controls selected, you edit them all at once.
  An orange dot marks controls that have metadata, and hovering a control shows it
  all.
- **LEDs.** RGB controls (pads, steps, track buttons, Play, Record) take a colour.
  White-LED controls (the other buttons and the printed icons under the step
  buttons) take a brightness. Set them in the inspector, or use the **Paint** tool
  (B): pick a colour, then click or drag across controls on any layout. Alt-click
  picks up a colour. "off" switches an LED off.
- **Screen.** Double-click the screen to open the 128 × 64 1-bit pixel editor. Its
  tools are pencil, eraser, line, rect, filled rect, fill and text (5×7 font), plus
  invert and clear. Left button draws white, right button or Alt draws black.
- **Scope.** Each layout covers a set of controls. Set it with the group
  checkboxes in the inspector, or with **Pick controls…** to toggle single
  controls. Controls outside the scope are dimmed and can't be edited, and the
  scope is summarised on the card ("All controls", "Encoders 1-8 + Volume", …).
- **Copy / paste control data.** Select controls, press Cmd/Ctrl+C, select the
  targets, then press Cmd/Ctrl+V. One source fills every target. Several sources
  map onto the targets in reading order. Cmd/Ctrl+Shift+V pastes only metadata,
  and Cmd/Ctrl+Alt+V pastes only LED colours. To paste across layouts, select a
  layout on the board (not a control) and paste: the data lands on the same
  controls there. The clipboard also works across browser tabs.

### Shortcuts

Press `?` in the app for the full list.

| | |
|---|---|
| Pan | Middle-mouse drag, Space + drag, trackpad two-finger scroll |
| Zoom | Scroll wheel (zooms toward the cursor), pinch, Cmd/Ctrl + = / − |
| Fit all / fit selection | Shift+1 / Shift+2 |
| Select | Click, Shift-click to add, drag a box from empty space (on the board, or on the active layout's body for controls) |
| Copy / cut / paste / duplicate | Cmd/Ctrl + C / X / V / D |
| Undo / redo | Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z |
| Select all | Cmd/Ctrl+A (all controls in scope while a layout is active) |
| Delete | Delete or Backspace (on controls: clears metadata and LED) |
| Nudge | Arrow keys (Shift for 10 px) |
| New layout / note / group | L / N / Cmd/Ctrl+G (frames the selection) |
| Paint tool / select tool | B / V |
| Labels on/off | T |

## Document format

The export is the same JSON that gets autosaved:

```jsonc
{
  "format": "ableton-move-designer",
  "version": 1,
  "name": "My firmware",
  "items": [                       // whiteboard, back to front
    {
      "type": "layout", "id": "…", "x": 80, "y": 120, "w": 1048, "h": 616,
      "name": "Global shortcuts",
      "description": "…",
      "scope": ["pad-1-1", "knob-1", "shift", …],   // control ids it covers
      "controls": {
        "pad-4-1": {
          "meta": { "label": "Kick", "function": "…", "click": "…", "hold": "…",
                    "doubleClick": "…", "shift": "…", "description": "…" },
          "led": { "color": "#ff5a1f" }              // RGB controls; null = off
        },
        "knob-1": { "meta": { "label": "Cutoff", "turn": "…", "touch": "…", "shiftTurn": "…" } },
        "copy":   { "led": { "brightness": 0.5 } }   // white-LED controls, 0..1
      },
      "screen": "AAAA…"            // base64, 1024 bytes: 128x64, row-major,
                                   // 16 bytes per row, MSB = leftmost pixel
    },
    { "type": "note",  "id": "…", "x": …, "y": …, "w": …, "h": …, "text": "…", "color": "#ffe58a" },
    { "type": "group", "id": "…", "x": …, "y": …, "w": …, "h": …, "title": "…", "color": "#6c8cff" }
  ]
}
```

Group membership is spatial, not stored: an item belongs to a group when it
lies inside the group's frame.

### Control ids and MIDI

Every control's hardware MIDI mapping is in `src/model/hardware.ts`, and the
inspector shows it for the selected control.

| Control ids | MIDI |
|---|---|
| `pad-<row>-<col>`, row 1 = top, col 1 = left | notes 68–99, bottom-left first |
| `step-1` … `step-16` | notes 16–31 |
| `stepicon-N` (the lightable printed icons under steps 1-3, 5-11, 14-16) | (no MIDI listed here) |
| `knob-1` … `knob-8` | CC 71–78, touch notes 0–7 |
| `volume` | CC 79, touch note 8 |
| `wheel` | CC 14, click CC 3, touch note 9 |
| `track-1` … `track-4`, top to bottom | CC 43, 42, 41, 40 |
| `shift` `menu` `back` `capture` `down` `up` `undo` `loop` `copy` `left` `right` `play` `record` `mute` `sample` `delete` | CC 49, 50, 51, 52, 54, 55, 56, 58, 60, 62, 63, 85, 86, 88, 118, 119 |
| `screen`, `power` | n/a |

## Code map

- `src/model/hardware.ts`: control ids, geometry, LED kinds, MIDI, scope groups
- `src/model/types.ts`: document types, defaults, import validation
- `src/model/ops.ts`: LED colour logic, control and board clipboard operations
- `src/store.ts`: zustand store, undo history, autosave
- `src/components/Board.tsx`: whiteboard canvas (pan, zoom, select, move, paint)
- `src/components/MoveSurface.tsx`: the SVG drawing of the Move
- `src/components/Inspector.tsx`, `MetaDialog.tsx`, `ScreenEditor.tsx`: editors
- `src/lib/bitmap.ts`, `src/lib/font.ts`: 1-bit bitmap ops and the 5×7 font
