'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../engine.js');

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGame(seed, opts) {
  const o = opts || { width: 9, height: 9, mines: 10 };
  return Engine.createGame({ width: o.width, height: o.height, mines: o.mines, rng: mulberry32(seed) });
}

function revealedSet(result) {
  const set = new Set();
  for (const e of result.events) {
    if (e.type === 'revealed') for (const i of e.cells) set.add(i);
  }
  return set;
}

function isConnected4(g, set) {
  const start = set.values().next().value;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const i = stack.pop();
    const x = i % g.width;
    const y = Math.floor(i / g.width);
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + d[0];
      const ny = y + d[1];
      if (nx < 0 || nx >= g.width || ny < 0 || ny >= g.height) continue;
      const j = g.idx(nx, ny);
      if (set.has(j) && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === set.size;
}

test('validateConfig accepts valid bounds and boundary values', () => {
  assert.equal(Engine.validateConfig(9, 9, 10), true);
  assert.equal(Engine.validateConfig(30, 24, 10), true);
  assert.equal(Engine.validateConfig(8, 8, 10), true);
  assert.equal(Engine.validateConfig(8, 8, 63), true); // 63 = 8*8-1
});

test('validateConfig rejects out-of-range values with RangeError', () => {
  assert.throws(() => Engine.validateConfig(7, 9, 10), RangeError);
  assert.throws(() => Engine.validateConfig(31, 9, 10), RangeError);
  assert.throws(() => Engine.validateConfig(9, 7, 10), RangeError);
  assert.throws(() => Engine.validateConfig(9, 25, 10), RangeError);
  assert.throws(() => Engine.validateConfig(9, 9, 9), RangeError);
  assert.throws(() => Engine.validateConfig(8, 8, 64), RangeError); // > w*h-1
  assert.throws(() => Engine.validateConfig(9.5, 9, 10), RangeError);
  assert.throws(() => Engine.validateConfig(9, 9, 10.5), RangeError);
});

test('createGame beginner shape and coordinate helpers', () => {
  const g = Engine.createGame(Engine.PRESETS.beginner);
  assert.equal(g.state, 'ready');
  assert.equal(g.cells.length, 81);
  assert.equal(g.flags, 0);
  assert.equal(g.elapsed, 0);
  assert.equal(g.mineCount, 10);
  assert.equal(g.idx(2, 3), 29);
  assert.deepEqual(g.xy(29), { x: 2, y: 3 });
  assert.equal(g.neighbors(g.idx(0, 0)).length, 3);
  assert.equal(g.neighbors(g.idx(4, 4)).length, 8);
  assert.equal(g.neighbors(g.idx(8, 8)).length, 3);
  for (const c of g.cells) {
    assert.deepEqual(c, { mine: false, revealed: false, flagged: false, question: false, adjacent: 0, exploded: false });
  }
});

test('first click is safe across 200 seeded games', () => {
  for (let seed = 0; seed < 200; seed++) {
    const g = makeGame(seed);
    const res = g.reveal(4, 4);
    assert.equal(g.state, 'playing', `seed ${seed}`);
    assert.equal(res.events[0].type, 'placed', `seed ${seed}`);
    assert.ok(res.events.some((e) => e.type === 'revealed'), `seed ${seed}`);
    const click = g.idx(4, 4);
    assert.equal(g.cells[click].mine, false, `seed ${seed}: mine on clicked cell`);
    for (const n of g.neighbors(click)) {
      assert.equal(g.cells[n].mine, false, `seed ${seed}: mine adjacent to click`);
    }
    assert.equal(g.cells.filter((c) => c.mine).length, 10, `seed ${seed}`);
  }
});

test('flag/question cycle order and flags count', () => {
  const g = makeGame(1);
  g.reveal(4, 4);
  const i = g.cells.findIndex((c) => !c.revealed);
  const { x, y } = g.xy(i);
  const c = g.cells[i];

  assert.equal(c.flagged, false);
  assert.equal(c.question, false);
  g.toggleFlag(x, y);
  assert.equal(c.flagged, true);
  assert.equal(c.question, false);
  assert.equal(g.flags, 1);
  g.toggleFlag(x, y);
  assert.equal(c.flagged, false);
  assert.equal(c.question, true);
  assert.equal(g.flags, 0);
  g.toggleFlag(x, y);
  assert.equal(c.flagged, false);
  assert.equal(c.question, false);
  assert.equal(g.flags, 0);

  // no-op on revealed cells
  const rv = g.cells.findIndex((cc) => cc.revealed);
  g.toggleFlag(...Object.values(g.xy(rv)));
  assert.equal(g.cells[rv].flagged, false);
  assert.equal(g.flags, 0);
});

test('flood fill opens the exact zero region (seeded oracle)', () => {
  let multiCellFlood = 0;
  for (let seed = 0; seed < 60; seed++) {
    const g = makeGame(seed);
    const click = g.idx(4, 4);
    const res = g.reveal(4, 4);
    const actual = revealedSet(res);

    // independent oracle BFS on the placed board
    const expected = new Set();
    const stack = [click];
    while (stack.length > 0) {
      const i = stack.pop();
      if (expected.has(i)) continue;
      const c = g.cells[i];
      if (c.mine || c.flagged) continue;
      expected.add(i);
      if (c.adjacent === 0) for (const n of g.neighbors(i)) stack.push(n);
    }

    assert.equal(actual.size, expected.size, `seed ${seed}`);
    for (const i of expected) assert.ok(actual.has(i), `seed ${seed}: missing ${i}`);
    for (const i of actual) assert.equal(g.cells[i].mine, false, `seed ${seed}: mine revealed`);
    assert.ok(isConnected4(g, actual), `seed ${seed}: region not contiguous`);
    if (actual.size >= 8) multiCellFlood++;
  }
  assert.ok(multiCellFlood > 0, 'expected at least one seed with a multi-cell flood');
});

test('chord does nothing when flag count mismatches or cell is covered', () => {
  let target = -1;
  let g = null;
  for (let seed = 0; seed < 100 && target === -1; seed++) {
    const cand = makeGame(seed + 500);
    cand.reveal(4, 4);
    for (let i = 0; i < cand.cells.length; i++) {
      if (cand.cells[i].revealed && cand.cells[i].adjacent >= 2) {
        target = i;
        g = cand;
        break;
      }
    }
  }
  assert.notEqual(target, -1, 'no revealed number cell found');
  const { x, y } = g.xy(target);
  assert.deepEqual(g.chord(x, y).events, []);
  assert.equal(g.state, 'playing');
  assert.deepEqual(g.chordPreview(x, y), []);

  const covered = g.cells.findIndex((c) => !c.revealed && !c.flagged);
  assert.deepEqual(g.chord(...Object.values(g.xy(covered))).events, []);
});

test('chord with a wrong flag loses and reports wrongFlags', () => {
  let done = false;
  for (let seed = 0; seed < 300 && !done; seed++) {
    const g = makeGame(seed + 1000);
    g.reveal(4, 4);
    for (let i = 0; i < g.cells.length && !done; i++) {
      const c = g.cells[i];
      if (!c.revealed || c.adjacent !== 1) continue;
      const ns = g.neighbors(i);
      const safeCovered = ns.filter((n) => {
        const nc = g.cells[n];
        return !nc.revealed && !nc.flagged && !nc.mine;
      });
      if (safeCovered.length === 0) continue;

      const flagAt = safeCovered[0];
      g.toggleFlag(...Object.values(g.xy(flagAt)));
      assert.equal(g.flags, 1);

      const preview = g.chordPreview(...Object.values(g.xy(i)));
      const targets = ns.filter((n) => !g.cells[n].flagged && !g.cells[n].revealed);
      assert.equal(preview.length, targets.length);

      const res = g.chord(...Object.values(g.xy(i)));
      assert.equal(g.state, 'lost');
      const lost = res.events.find((e) => e.type === 'lost');
      assert.ok(lost, 'expected a lost event');
      assert.equal(lost.mines.length, 10);
      assert.ok(g.cells[lost.exploded].mine, 'exploded cell must be a mine');
      assert.equal(g.cells[lost.exploded].exploded, true);
      assert.deepEqual([...lost.wrongFlags].sort((a, b) => a - b), [flagAt]);
      done = true;
    }
  }
  assert.ok(done, 'no suitable chording situation found across 300 seeds');
});

test('win when all safe cells are revealed', () => {
  const g = makeGame(42);
  g.reveal(4, 4);
  assert.notEqual(g.state, 'won');
  const safe = [];
  for (let i = 0; i < g.cells.length; i++) if (!g.cells[i].mine) safe.push(i);
  let sawWon = false;
  for (const i of safe) {
    const res = g.reveal(...Object.values(g.xy(i)));
    if (res.events.some((e) => e.type === 'won')) sawWon = true;
  }
  assert.ok(sawWon, 'expected a won event');
  assert.equal(g.state, 'won');
  for (const c of g.cells) assert.ok(c.mine || c.revealed);
  assert.equal(g.cells.filter((c) => c.mine && c.revealed).length, 0);
  // board is inert after win
  const covered = g.cells.findIndex((c) => !c.revealed);
  assert.deepEqual(g.reveal(...Object.values(g.xy(covered))).events, []);
  const f0 = g.flags;
  g.toggleFlag(...Object.values(g.xy(covered)));
  assert.equal(g.flags, f0);
});

test('loss reports all mines', () => {
  const g = makeGame(7);
  g.reveal(4, 4);
  const mineIdx = g.cells.findIndex((c) => c.mine && !c.revealed);
  assert.notEqual(mineIdx, -1);
  const res = g.reveal(...Object.values(g.xy(mineIdx)));
  assert.equal(g.state, 'lost');
  const lost = res.events.find((e) => e.type === 'lost');
  assert.ok(lost);
  assert.equal(lost.mines.length, 10);
  const expected = g.cells.map((c, i) => (c.mine ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual([...lost.mines].sort((a, b) => a - b), expected.sort((a, b) => a - b));
  assert.ok(g.cells[lost.exploded].mine);
  assert.equal(g.cells[lost.exploded].exploded, true);
  assert.deepEqual(lost.wrongFlags, []);
  // board is inert after loss
  assert.deepEqual(g.reveal(0, 0).events, []);
});

test('tick advances only while playing and caps at 999', () => {
  const g = makeGame(3);
  g.tick();
  assert.equal(g.elapsed, 0); // ready: no advance
  g.reveal(4, 4);
  g.tick();
  assert.equal(g.elapsed, 1);
  g.elapsed = 998;
  g.tick();
  assert.equal(g.elapsed, 999);
  g.tick();
  assert.equal(g.elapsed, 999); // capped
  const mineIdx = g.cells.findIndex((c) => c.mine);
  g.reveal(...Object.values(g.xy(mineIdx)));
  g.tick();
  assert.equal(g.elapsed, 999); // lost: frozen
});

test('displayCounter clamps to [-99, 999]', () => {
  const g = makeGame(5);
  assert.equal(g.displayCounter(), 10);
  let n = 0;
  for (const c of g.cells) {
    if (n >= 11) break;
    if (!c.flagged) {
      c.flagged = true;
      g.flags++;
      n++;
    }
  }
  assert.equal(g.displayCounter(), -1);
  g.flags = 200; // 10 - 200 = -190
  assert.equal(g.displayCounter(), -99);
  g.flags = -1000; // 10 + 1000 = 1010
  assert.equal(g.displayCounter(), 999);
  g.flags = -989; // exactly 999
  assert.equal(g.displayCounter(), 999);
});
