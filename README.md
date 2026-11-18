# viel — Minesweeper (1992)

A faithful recreation of the 1992 Windows 3.1 Minesweeper in vanilla HTML/CSS/JS.
No frameworks, no external assets, no build step — works offline straight from
`index.html`.

## Run it

Open `index.html` in any browser, or serve the folder statically:

```sh
npx serve .        # or python -m http.server
```

## How to play

- **Left click** — reveal a cell (the first click is always safe)
- **Right click** — cycle flag → ? → unmark
- **Click a revealed number** — chord: reveals its neighbors when the flag count matches
- **Smiley button** — restart (it wears sunglasses when you win, dies when you lose)
- **Game menu** — New, Beginner (9×9/10), Intermediate (16×16/40), Expert (30×16/99),
  Custom (8×8–30×24), Marks (?) toggle, Best Times (saved in `localStorage`)

## Project layout

| File | Role |
|---|---|
| `index.html` | Static Win3.1 window shell (menus, LEDs, dialogs) |
| `style.css` | The entire look — bevels, 7-segment LEDs, glyphs (all CSS/SVG data URIs) |
| `engine.js` | Pure game logic (no DOM): placement, flood fill, chord, win/loss |
| `app.js` | DOM glue: rendering, input, menus, timer, best times |
| `test/engine.test.js` | Node test suite for the engine |
| `SPEC.md` | Original build spec |

## Tests

```sh
node --test test/engine.test.js
```

Built with subagents: one for the engine + tests, one for the UI shell, one
for the integration.
