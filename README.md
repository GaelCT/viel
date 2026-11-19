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

## Daily Challenges (offline)

Choose **Game → Daily Challenge**, select Beginner, Intermediate or Expert, and
press **Start challenge**. Each UTC date (`YYYY-MM-DD`) and difficulty identifies
one board. The center square (`floor(width/2), floor(height/2)`) opens automatically
and is safe along with its neighbors. Boards are not guaranteed guess-free.
The date and difficulty appear above the board, separate from classic best times.
Starting again, **New**, or the smiley resets the same board, even after midnight.
Choosing a preset or confirming Custom returns to classic random play.

**Game → Share Challenge** displays a selectable code. Use **Copy code**, or
select the field and press Ctrl+C / your device's copy command when clipboard
access is unavailable (including `file://`). **Game → Import Challenge** validates
the entire code before starting a fresh attempt. A code contains only a version,
UTC date, difficulty, integer seed, center opening and checksum; it contains no
mine array, moves or personal information. The checksum detects transcription
errors; it is not an authentication mechanism. Codes are limited to 512 characters.

When browser storage is available, challenge actions, flags/question marks,
Marks (?) setting and elapsed active seconds save after moves, timer ticks and
page exit. Reload resumes the current attempt. Hidden/closed time does not count;
only whole active seconds are retained across reloads. The LED caps at 999, but
the full challenge time is saved and shown in history/replay. Storage failures
show a notice and play continues in memory. Starting another game replaces the
current attempt; unfinished attempts do not enter history.

After finishing, choose **Replay finished challenge** or open a result from
**Game → Challenge History**. Use **Play**, **Pause**, **Step forward** and
**Restart replay**; progress shows actions and seconds. Playback follows recorded
times, with at most ten moves per second so simultaneous actions remain visible.
Board input, New/smiley, difficulty changes and Marks are disabled during replay;
**Exit replay** restores the exact live game. Replays never save moves, add results,
or affect classic records. Challenge wins never trigger the fastest-time prompt.

All data stays in this browser, with no accounts, network requests or services.
Challenge storage uses `minesweeper.challenge.session.v1` and
`minesweeper.challenge.history.v1`; classic records continue using
`minesweeper.best.v1`. History retains the newest **30 finished attempts**, evicting
older attempts sooner to fit **2 MiB**. **Clear history** removes stored results
without changing the current game. Each attempt is limited to **4096 actions**,
**512 KiB** and **31,536,000 active seconds** (one year); a visible notice asks you
to restart if the action/time limit is reached. Marks-setting changes count as
actions. Browser site-data controls can remove all locally saved data. Storage
availability and retention depend on the browser, including for local files.

V1 determinism is fixed: FNV-1a hashes the ASCII identity
`MSD1|YYYY-MM-DD|difficulty` to an unsigned 32-bit seed; Mulberry32 drives the
engine's Fisher-Yates placement after the fixed center reveal. Literal golden
vectors cover all presets. Changes to this contract require a new version.

## Project layout

| File | Role |
|---|---|
| `index.html` | Static Win3.1 window shell (menus, LEDs, dialogs) |
| `style.css` | The entire look — bevels, 7-segment LEDs, glyphs (all CSS/SVG data URIs) |
| `engine.js` | Pure game logic (no DOM): placement, flood fill, chord, win/loss |
| `challenge.js` | Versioned deterministic challenges, code/save validation and action replay |
| `app.js` | DOM glue: rendering, input, menus, timer, best times |
| `test/engine.test.js` | Node test suite for the engine |
| `SPEC.md` | Original build spec |

## Tests

```sh
node --test "test/*.test.js"
node node_modules/@playwright/test/cli.js test
```

Built with subagents: one for the engine + tests, one for the UI shell, one
for the integration.
