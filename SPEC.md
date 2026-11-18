# SPEC — Minesweeper (1992 Windows 3.1 clone)

A faithful recreation of the 1992 Windows 3.1 Minesweeper in vanilla HTML/CSS/JS.
No frameworks, no external assets, no network dependencies. Everything must work
from `file://` or a static server.

## Visual identity (Windows 3.1 / Win95 hybrid, classic look)

- Desktop-like backdrop (classic teal `#008080` tiling background).
- A window with:
  - Title bar (blue gradient `#000080`→`#1084d0`, white bold title "Minesweeper",
    min/max/close buttons with classic bevel glyphs).
  - Menu bar: **Game** (New, separator, Beginner, Intermediate, Expert, Custom…,
    separator, Marks (?), Best Times…, separator, Exit) and **Help** (How to
    Play…, About Minesweeper…). Menus drop down with classic white background,
    black text, and a highlighted selection bar.
  - Status panel: sunken inset area containing
    - LED mine counter (3 digits, red 7-segment style on black) on the left,
    - smiley face button centered (classic yellow face; states: normal 😊,
      pressed 😮 while a mouse button is held, dead 😵 on loss, cool 😎 on win),
    - LED timer (3 digits) on the right.
  - Minefield: sunken gray panel, grid of beveled cells. Covered cell = raised
    3D bevel; revealed cell = sunken flat gray. Classic number colors:
    1 blue, 2 green, 3 red, 4 dark blue, 5 maroon, 6 teal, 7 black, 8 gray.
  - Everything uses chunky 2px 3D bevels (light `#ffffff`/`#dfdfdf`,
    dark `#808080`/`#404040`), the gray chrome palette (`#c0c0c0`), and a
    pixelated feel. Render cells with CSS only (no image files).
- Font: classic system look (Tahoma/'MS Sans Serif' stack), fallback `sans-serif`,
  small sizes. Numbers on cells use bold, centered.

## Interactions

- **Left click** a covered cell → reveal. First reveal of a game is always safe
  (mines are placed after the first click, avoiding that cell AND its 8
  neighbors). Flood-fill reveals all connected zero cells plus their number
  ring.
- **Right click** a covered cell → cycle covered → flag → question mark →
  covered. When "Marks (?)" menu option is off, skip the question mark state.
- **Chord**: clicking an already-revealed number whose flag count among its
  neighbors equals its number reveals all its non-flagged covered neighbors.
  Pressing a mouse button with the cursor on such a cell (both buttons down,
  or left-click on the number) shows the "pressed" look on those neighbors
  while the button is held. If a flagged cell is wrongly flagged, chording on
  it detonates a mine.
- Smiley button → new game (any state). Also Game → New.
- Timer starts on first reveal click, capped at 999.
- Mine counter shows `mines - flags`, can go negative (e.g. `-01`), capped
  display at -99/999.
- **Losing**: the clicked mine shows as a red-background detonated mine; all
  other mines show; wrongly placed flags show a crossed-out mine; smiley dies;
  board becomes inert.
- **Winning**: all non-mine cells revealed → mines show as flags, smiley wears
  sunglasses, timer stops.

## Difficulty

| Level        | Width | Height | Mines |
|--------------|-------|--------|-------|
| Beginner     | 9     | 9      | 10    |
| Intermediate | 16    | 16     | 40    |
| Expert       | 30     | 16    | 99    |
| Custom       | 8–30  | 8–24   | 10–(w*h−1) |

Custom dialog: classic modal with three numeric fields (Height, Width, Mines)
and OK/Cancel.

## Best times

Persist per difficulty in `localStorage` (key `minesweeper.best.v1`).
"Best Times…" shows a modal listing Beginner/Intermediate/Expert records and
a Reset button.

## Architecture

- `engine.js` — **pure logic, zero DOM access**. UMD-lite export so both the
  browser (`window.MinesweeperEngine`) and Node (`require`) can use it.
  Exposes: `createGame(opts)` → game object with
  `{ state: 'ready'|'playing'|'won'|'lost', width, height, mines, flags,
     cells: [{mine, revealed, flagged, question, adjacent, exploded}], … }`
  plus `reveal(x,y)`, `toggleFlag(x,y)`, `chord(x,y)` (all pure: return events
  like `{type:'revealed',cells:[…]}` / `{type:'lost'| 'won'}` without touching
  DOM), `difficulty presets`, and `serialize/restore` for the smiley state.
  Engine owns mine placement (seedable RNG for tests, default `Math.random`).
- `app.js` — DOM glue: builds the board grid, renders cell state changes,
  wires menus/dialogs/smiley, drives the LED counter + timer, persists best
  times. Renderer should update only changed cells.
- `index.html` — static shell: window chrome, menu bar, status bar, board
  container, dialogs (Custom, Best Times, About, How to Play).
- `style.css` — all styling, including 7-segment LED digits (CSS-drawn or
  minimal inline SVG) and the 3D bevels. Use CSS Grid for the board
  (`grid-template-columns: repeat(N, 16px)`), logical properties where useful.
- `test/engine.test.js` — Node built-in test runner (`node --test`), no deps.
  Must cover: first-click safety, flood fill, flag/question cycling, chord,
  win detection, loss reveals mines + marks wrong flags, timer cap logic
  helpers, counter clamping, custom difficulty validation.

## Compatibility

Modern evergreen browsers only; no polyfills required. Must run offline.
