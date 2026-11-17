# Ableton Move Designer

A browser tool for planning control layouts for the Ableton Move: what every pad,
step button, encoder, button and the screen does in each mode of your firmware.

Layouts sit on a Figma-style whiteboard as full drawings of the Move. Zoom in and
edit them in place, side by side, without opening a separate editor.

The drawing matches Ableton's official *Move's Controls* diagram from the
[Move manual](https://www.ableton.com/en/move/manual/): positions, spacing and
proportions are measured from it (`src/model/hardware.ts`).

Live: https://quixotic7.github.io/abletonmovedesigner/

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

Every push to `main` builds and deploys to GitHub Pages
(`.github/workflows/deploy.yml`).

## Using it

- **Board.** Layouts, standalone screens, sticky notes and groups (titled
  frames). A **screen** (+ Screen, or S) is a 128 × 64 Move display on its own,
  with a name and description: double-click it (or press Enter) to open the
  screen editor, and hover it to play its animation. "Copy to board as a screen"
  in a layout's inspector copies that layout's screen out as one. Drag a layout by its
  title bar, a note anywhere, a group by its title tab. Anything inside a group's
  frame moves with the group. Notes and groups resize from the bottom-right corner.
- **Edit a layout in place.** Click any control on a layout to select it; that
  layout becomes the active one, outlined in orange, and the inspector opens on the
  right. Double-click a layout's title to zoom to it. Esc, the breadcrumb or
  **← Back** returns you to the board and restores your previous view.
- **Control metadata.** Select a control and edit its fields right in the
  inspector on the right (they save as you type), or double-click it / press
  Enter for a larger dialog. The fields are Label, Function, Quick click, Hold, Double-click,
  Shift + press and Description. Encoders, Volume and the jog wheel also get Turn,
  Touch and Shift + turn. With several controls selected, you edit them all at once.
  An orange dot marks controls that have metadata, and hovering a control shows it
  all.
- **LEDs.** RGB controls (pads, steps, track buttons, the LEDs under the encoders,
  Play, Record) take a colour.
  White-LED controls (the other buttons and the printed icons under the step
  buttons) take a brightness. Set them in the inspector, or use the **Paint** tool
  (B): pick a colour, then click or drag across controls on any layout. Alt-click
  picks up a colour. "off" switches an LED off.
- **Screen.** Double-click the screen to open the screen editor: a 128 × 64 1-bit
  canvas with the same navigation as the board (wheel zoom, middle or Space drag
  to pan, Shift+1 to fit).
  - **Layers.** Raster layers have transparency and can be moved without losing
    pixels. Text layers stay editable: text, font (Pixel 5×7, Pixel 3×5, the
    EvilGenius firmware's own two fonts, Big 8×8 and Small 4×6, or a system font
    drawn crisp in 1-bit), size (pixel fonts in whole multiples: 1×, 2×, 3× ...),
    bold, white or black, an optional box
    behind, and position. With the text, move or select tool, drag a text box to
    move it and drag a corner handle to change the font size (the opposite
    corner stays put). **Convert to raster** turns text into pixels. You can
    also hide, reorder, duplicate, merge down, flatten and rename layers.
  - **Tools.** Box select (M), move layer (V), brush (B), eraser (E), line (L),
    rectangle (R), ellipse (O), fill (G), dither gradient (D, linear or radial)
    and text (T). Brushes come in round, square and spray, 1 to 16 px (`[` `]`).
    The dither patterns (P cycles them) apply to brushes, shapes and fills; their
    gaps take the other colour, covering what's underneath, unless you tick
    **Transparent gaps**. X swaps white and black; right-click or Alt draws the
    other colour. Hold Shift while drawing to lock the brush or eraser to one
    axis; Shift-click draws a straight line from the last point; Shift constrains
    lines and shapes. The fill tool fills the detected area or the whole
    selection (or screen); Shift-click does the other one.
  - **Boxes and ellipses** have separate **Outline** and **Fill** settings: the
    outline uses the main colour, brush size, dither and line style; the fill
    has its own colour and dither (F toggles it). Lines and outlines can be
    solid, dashed, dotted or a custom dash/gap; dashes run continuously round
    corners. Dithers in boxes, ellipses and fills start at the point you click
    (brush dithers stay locked to the screen so strokes join up).
  - **Selection.** Drag a box, then drag inside it to move those pixels.
    Painting, fills and gradients stay inside the box while it's there.
    Cmd/Ctrl + C / X / V copies, cuts and pastes; a paste lands as a new layer.
    The clipboard works across frames and layouts. Cmd/Ctrl+A selects all, and
    Esc or Cmd/Ctrl+D deselects.
  - **Frames.** For mocking up animations: duplicate or add frames, set each
    frame's duration, reorder them, step through with `,` and `.`, play with
    Enter, and turn on onion skin to see the previous frame in red. The layout
    shows frame 1.
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
| Pan | Middle-mouse drag, Space + drag, Shift + scroll, sideways scroll (vertical scrolling always zooms) |
| Zoom | Scroll wheel (zooms toward the cursor), pinch, Cmd/Ctrl + = / − |
| Fit all / fit selection | Shift+1 / Shift+2 |
| Select | Click, Shift-click to add, drag a box from empty space (on the board, or on the active layout's body for controls) |
| Copy / cut / paste / duplicate | Cmd/Ctrl + C / X / V / D |
| Undo / redo | Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z |
| Select all | Cmd/Ctrl+A (all controls in scope while a layout is active) |
| Delete | Delete or Backspace (on controls: clears metadata and LED) |
| Nudge | Arrow keys (Shift for 10 px) |
| New layout / screen / note / group | L / S / N / Cmd/Ctrl+G (frames the selection) |
| Paint tool / select tool | B / V |
| Labels on/off | T |

## Document format

The export is the same JSON that gets autosaved:

```jsonc
{
  "format": "ableton-move-designer",
  "version": 3,
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
      "screen": "AAAA…",           // base64, 1024 bytes: 128x64, row-major,
                                   // 16 bytes per row, MSB = leftmost pixel
                                   // (always the flattened frame 1)
      "screenFrames": [            // optional; written once the screen is edited
        {
          "id": "…", "duration": 200,          // ms
          "image": "AAAA…",                    // this frame flattened, same packing
          "layers": [                          // bottom to top
            { "type": "raster", "id": "…", "name": "Background", "visible": true,
              "x": 0, "y": 0, "data": "…", "alpha": "…" },  // pixels + opacity, same packing
            { "type": "text", "id": "…", "name": "Title", "visible": true, "x": 4, "y": 4,
              "text": "Drum Rack", "font": "pixel-5x7", "size": 7,   // pixel fonts: "pixel-5x7",
              "bold": false, "ink": 1, "box": false }                // "pixel-3x5", "eg-big", "eg-small";
                                                                     // size = its height x a whole multiple
          ]
        }
      ]
    },
    { "type": "screen", "id": "…", "x": …, "y": …, "w": …, "h": …,
      "name": "Boot animation", "description": "…",
      "screen": "AAAA…", "screenFrames": [ … ] },   // same as a layout's screen
    { "type": "note",  "id": "…", "x": …, "y": …, "w": …, "h": …, "text": "…", "color": "#ffe58a" },
    { "type": "group", "id": "…", "x": …, "y": …, "w": …, "h": …, "title": "…", "color": "#6c8cff" }
  ]
}
```

Version 2 added the encoder LEDs; when a version 1 document is loaded, layouts
that covered all eight encoders get their LEDs added to the scope.

Version 3 added layers, text and frames for screens (`screenFrames`) and
standalone `screen` items.

Group membership is spatial, not stored: an item belongs to a group when it
lies inside the group's frame.

### Control ids and MIDI

Every control's hardware MIDI mapping is in `src/model/hardware.ts`, and the
inspector shows it for the selected control. The LED numbers for the encoder LEDs
and step icons come from the community reference
[Addressing Move's UI over MIDI](https://github.com/charlesvestal/extending-move/wiki/Addressing-Move's-UI-over-MIDI):
pads, steps and encoder LEDs take a colour value, other lights a brightness.

| Control ids | MIDI |
|---|---|
| `pad-<row>-<col>`, row 1 = top, col 1 = left | notes 68–99, bottom-left first |
| `step-1` … `step-16` | notes 16–31 |
| `stepicon-N` (the lightable printed icons under steps 1-3, 5-11, 14-16) | LED CC 16–31 (CC 15 + step number) |
| `knob-1` … `knob-8` | CC 71–78, touch notes 0–7 |
| `knobled-1` … `knobled-8` (the LEDs under the encoders) | LED CC 71–78 (the value picks the colour) |
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
- `src/lib/fontEG.ts`: the EvilGenius firmware's two fonts, generated from its `core/ui/px_art.h`
