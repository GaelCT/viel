'use strict';

// Pure game logic for a 1992 Windows 3.1 Minesweeper clone. Zero DOM access.

const PRESETS = {
  beginner: { width: 9, height: 9, mines: 10 },
  intermediate: { width: 16, height: 16, mines: 40 },
  expert: { width: 30, height: 16, mines: 99 }
};

function validateConfig(width, height, mines) {
  if (!Number.isInteger(width) || width < 8 || width > 30) {
    throw new RangeError('width must be an integer in [8, 30]');
  }
  if (!Number.isInteger(height) || height < 8 || height > 24) {
    throw new RangeError('height must be an integer in [8, 24]');
  }
  if (!Number.isInteger(mines) || mines < 10 || mines > width * height - 1) {
    throw new RangeError('mines must be an integer in [10, width*height-1]');
  }
  return true;
}

function createGame(opts) {
  opts = opts || {};
  const width = opts.width;
  const height = opts.height;
  const mineCount = opts.mines;
  validateConfig(width, height, mineCount);
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;

  const cells = new Array(width * height);
  for (let i = 0; i < cells.length; i++) {
    cells[i] = { mine: false, revealed: false, flagged: false, question: false, adjacent: 0, exploded: false };
  }

  const game = {
    state: 'ready',
    width: width,
    height: height,
    mineCount: mineCount,
    flags: 0,
    elapsed: 0,
    cells: cells,
    idx: idx,
    xy: xy,
    neighbors: neighbors,
    reveal: reveal,
    toggleFlag: toggleFlag,
    chord: chord,
    chordPreview: chordPreview,
    tick: tick,
    displayCounter: displayCounter
  };

  function idx(x, y) {
    return y * width + x;
  }

  function xy(i) {
    return { x: i % width, y: Math.floor(i / width) };
  }

  function neighbors(i) {
    const x = i % width;
    const y = Math.floor(i / width);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) out.push(ny * width + nx);
      }
    }
    return out;
  }

  // Fisher-Yates over candidate cells; the clicked cell and its 8 neighbors
  // are excluded so the first click is always safe. If the board is too dense
  // to exclude all neighbors, fall back to excluding only the clicked cell.
  function placeMines(clickIdx) {
    let candidates = [];
    for (let i = 0; i < cells.length; i++) {
      if (i !== clickIdx && !neighbors(clickIdx).includes(i)) candidates.push(i);
    }
    if (candidates.length < mineCount) {
      candidates = [];
      for (let i = 0; i < cells.length; i++) if (i !== clickIdx) candidates.push(i);
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = t;
    }
    for (let k = 0; k < mineCount; k++) cells[candidates[k]].mine = true;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].mine) continue;
      const ns = neighbors(i);
      let n = 0;
      for (let k = 0; k < ns.length; k++) if (cells[ns[k]].mine) n++;
      cells[i].adjacent = n;
    }
  }

  function allSafeRevealed() {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c.mine && !c.revealed) return false;
    }
    return true;
  }

  // Reveal a batch of cells, flood-filling zeros. May push 'revealed', 'lost'
  // or 'won' events. Stops at the first mine hit (game over).
  function revealBatch(seedIndices, events) {
    const revealed = [];
    let exploded = -1;
    const stack = seedIndices.slice();
    while (stack.length > 0) {
      const i = stack.pop();
      const c = cells[i];
      if (c.revealed || c.flagged) continue;
      if (c.mine) {
        exploded = i;
        break;
      }
      c.revealed = true;
      revealed.push(i);
      if (c.adjacent === 0) {
        const ns = neighbors(i);
        for (let k = 0; k < ns.length; k++) {
          if (!cells[ns[k]].revealed && !cells[ns[k]].flagged) stack.push(ns[k]);
        }
      }
    }
    if (revealed.length > 0) events.push({ type: 'revealed', cells: revealed });
    if (exploded !== -1) {
      cells[exploded].exploded = true;
      game.state = 'lost';
      const mines = [];
      const wrongFlags = [];
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].mine) mines.push(i);
        else if (cells[i].flagged) wrongFlags.push(i);
      }
      events.push({ type: 'lost', exploded: exploded, mines: mines, wrongFlags: wrongFlags });
    } else if (game.state === 'playing' && allSafeRevealed()) {
      game.state = 'won';
      events.push({ type: 'won' });
    }
  }

  function reveal(x, y) {
    if (game.state === 'won' || game.state === 'lost') return { events: [] };
    const i = idx(x, y);
    const cell = cells[i];
    if (cell.revealed || cell.flagged) return { events: [] };
    const events = [];
    if (game.state === 'ready') {
      placeMines(i);
      game.state = 'playing';
      events.push({ type: 'placed' });
    }
    revealBatch([i], events);
    return { events: events };
  }

  // covered -> flagged -> question -> covered
  function toggleFlag(x, y) {
    if (game.state === 'won' || game.state === 'lost') return;
    const c = cells[idx(x, y)];
    if (c.revealed) return;
    if (!c.flagged && !c.question) {
      c.flagged = true;
      game.flags++;
    } else if (c.flagged) {
      c.flagged = false;
      c.question = true;
      game.flags--;
    } else {
      c.question = false;
    }
  }

  // Neighbors a chord would reveal, or null when the chord precondition
  // (revealed cell whose adjacent equals its neighbor flag count) fails.
  function chordTargets(i) {
    const c = cells[i];
    if (game.state !== 'playing' || !c.revealed) return null;
    const ns = neighbors(i);
    let flags = 0;
    const targets = [];
    for (let k = 0; k < ns.length; k++) {
      const nc = cells[ns[k]];
      if (nc.flagged) flags++;
      else if (!nc.revealed) targets.push(ns[k]);
    }
    if (flags !== c.adjacent) return null;
    return targets;
  }

  function chord(x, y) {
    const targets = chordTargets(idx(x, y));
    if (!targets || targets.length === 0) return { events: [] };
    const events = [];
    revealBatch(targets, events);
    return { events: events };
  }

  function chordPreview(x, y) {
    const targets = chordTargets(idx(x, y));
    return targets ? targets.slice() : [];
  }

  function tick() {
    if (game.state === 'playing') game.elapsed = Math.min(999, game.elapsed + 1);
  }

  function displayCounter() {
    return Math.max(-99, Math.min(999, mineCount - game.flags));
  }

  return game;
}

const Engine = { PRESETS: PRESETS, validateConfig: validateConfig, createGame: createGame };

if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
if (typeof window !== 'undefined') window.MinesweeperEngine = Engine;
