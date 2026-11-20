'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../challenge');

const clone = value => JSON.parse(JSON.stringify(value));
const mines = g => g.cells.flatMap((c, i) => c.mine ? [i] : []);
function attempt(date = '2026-01-01', difficulty = 'beginner') {
  const session = C.newSession(C.daily(date, difficulty), true, 'test-attempt');
  const state = { game: C.createGame(session.descriptor), marks: true };
  function act(type, index, elapsed = state.game.elapsed + 1) {
    const action = { type, elapsed, marks: type === 'marks' ? !state.marks : state.marks };
    if (type !== 'marks') Object.assign(action, state.game.xy(index));
    assert.ok(C.applyAction(state, action), 'expected accepted ' + JSON.stringify(action));
    session.actions.push(action); session.marks = state.marks; session.elapsed = elapsed;
  }
  return { session, state, act };
}
function finish(a, won = false) {
  if (!won) a.act('reveal', mines(a.state.game)[0]);
  else for (let i = 0; i < a.state.game.cells.length; i++) {
    const c = a.state.game.cells[i];
    if (!c.mine && !c.revealed) a.act('reveal', i);
  }
  return a.session;
}
function snapshot(g) { return { cells: g.cells, state: g.state, flags: g.flags, elapsed: g.elapsed }; }

test('V1 golden seed, integer RNG, complete placement and fixed openings across presets', () => {
  const rng = C.rng(1);
  assert.deepEqual(Array.from({ length: 5 }, () => rng() * 4294967296),
    [2693262067, 11749833, 2265367787, 4213581821, 4159151403]);
  const vectors = [
    ['beginner', 3973044606, [4, 4], [4,5,11,12,28,29,33,76,79,80]],
    ['intermediate', 1174292409, [8, 8], [10,21,25,29,54,59,61,66,69,76,90,91,97,99,100,104,109,110,118,124,125,132,133,161,172,176,189,194,195,201,203,209,215,221,227,231,237,242,243,246]],
    ['expert', 3298214628, [15, 8], [10,12,17,30,31,32,41,43,48,55,61,62,64,65,67,71,89,92,93,96,98,101,106,107,109,110,115,123,126,136,143,147,151,153,155,160,163,167,170,174,179,186,194,199,200,202,204,205,214,215,219,233,239,245,264,272,273,274,276,277,287,289,296,305,307,319,320,321,329,331,335,349,355,360,369,370,385,389,395,399,408,409,410,414,420,425,427,430,434,435,439,443,446,448,454,457,458,478,479]]
  ];
  for (const [level, seed, opening, expected] of vectors) {
    const d = C.daily('2026-01-01', level);
    assert.equal(d.seed, seed); assert.deepEqual([d.opening.x, d.opening.y], opening);
    const g = C.createGame(d);
    assert.deepEqual(mines(g), expected);
    assert.deepEqual(snapshot(C.createGame(C.decode(C.code(d)))) , snapshot(g));
    const first = g.idx(...opening);
    assert.ok(g.cells[first].revealed);
    for (const i of [first, ...g.neighbors(first)]) assert.equal(g.cells[i].mine, false);
  }
});

test('UTC boundaries, offsets and real leap dates', () => {
  assert.equal(C.utcDate(new Date('2026-01-01T00:00:00Z')), '2026-01-01');
  assert.equal(C.utcDate(new Date('2025-12-31T23:59:59.999Z')), '2025-12-31');
  assert.equal(C.utcDate(new Date('2026-01-01T22:00:00-08:00')), '2026-01-02');
  assert.equal(C.daily('2024-02-29').date, '2024-02-29');
  for (const value of ['2025-02-29', '2026-02-30', '2026-13-01', '0000-01-01', '2026-1-1', '<script>', null])
    assert.throws(() => C.daily(value));
});

test('canonical code rejects tampering, invalid fields, unsupported and oversized input', () => {
  const d = C.daily('2026-01-01');
  const code = C.code(d);
  assert.deepEqual(C.decode(' \n' + code + '\n'), d);
  for (const bad of [null, {}, '', code.replace('2026', '2027'), code.replace('MSD1', 'MSD2'), code + '|x', 'x'.repeat(513), '<img onerror=alert(1)>'])
    assert.throws(() => C.decode(bad));
  // Recomputed checksums do not permit inconsistent descriptors.
  for (const body of ['MSD1|2026-01-01|beginner|0|4|4', 'MSD1|2026-01-01|custom|0|4|4',
    'MSD1|2026-01-01|beginner|4294967296|4|4', 'MSD1|2026-01-01|beginner|3973044606|5|4',
    'MSD1|2026-02-30|beginner|0|4|4', 'MSD1|2026-01-01|beginner|03973044606|4|4'])
    assert.throws(() => C.decode(body + '|' + C.hash(body).toString(16).padStart(8, '0')));
  for (const bad of [{ ...d, version: 2 }, { ...d, seed: -1 }, { ...d, difficulty: ['beginner'] },
    { ...d, extra: true }, { ...d, date: undefined }, { ...d, opening: { x: 4, y: 4, mine: true } }])
    assert.throws(() => C.descriptor(bad));
});

test('all mark states, disabled marks and setting-only changes round trip with active elapsed time', () => {
  const a = attempt();
  const i = a.state.game.cells.findIndex(c => !c.revealed);
  a.act('mark', i, 2); assert.equal(a.state.game.flags, 1);
  a.act('mark', i, 4); assert.equal(a.state.game.cells[i].question, true);
  a.act('mark', i, 7); assert.equal(a.state.game.cells[i].question, false);
  a.act('marks', null, 10);
  a.act('mark', i, 11); a.act('mark', i, 13);
  assert.equal(a.state.game.cells[i].question, false);
  assert.equal(a.state.game.flags, 0);
  a.act('marks', null, 14); a.act('mark', i, 15); a.act('mark', i, 16);
  a.session.elapsed = 1200; a.state.game.elapsed = 1200;
  const saved = C.readSession(C.writeSession(a.session));
  const restored = C.reconstruct(saved);
  assert.deepEqual(snapshot(restored.game), snapshot(a.state.game));
  assert.equal(restored.marks, true);
  assert.equal(restored.game.elapsed, 1200); // no Date.now or closed-time arithmetic
  assert.equal(restored.game.cells[i].question, true);
  a.act('marks', null, 1201);
  assert.equal(C.reconstruct(C.readSession(C.writeSession(a.session))).marks, false);
});

test('successful and losing chords replay exact board, flags, result and timer', () => {
  for (const wrong of [false, true]) {
    const a = attempt(); const g = a.state.game;
    const i = g.cells.findIndex((c, i) => c.revealed && c.adjacent === 1 &&
      g.neighbors(i).some(n => !g.cells[n].revealed && !g.cells[n].mine));
    assert.ok(i >= 0);
    const target = g.neighbors(i).find(n => !g.cells[n].revealed && g.cells[n].mine !== wrong);
    a.act('mark', target, 5); a.act('chord', i, 8);
    assert.equal(g.state, wrong ? 'lost' : 'playing');
    assert.deepEqual(snapshot(C.reconstruct(C.readSession(C.writeSession(a.session))).game), snapshot(g));
    // Every prefix is playable for Step; replaying does not mutate its source.
    const original = clone(a.session);
    for (let n = 0; n <= a.session.actions.length; n++) C.reconstruct(a.session, n);
    assert.deepEqual(a.session, original);
  }
});

test('winning and losing attempts preserve exact final elapsed and ignore further actions', () => {
  for (const won of [false, true]) {
    const a = attempt(); finish(a, won);
    const restored = C.reconstruct(C.readSession(C.writeSession(a.session)));
    assert.equal(restored.game.state, won ? 'won' : 'lost');
    assert.deepEqual(snapshot(restored.game), snapshot(a.state.game));
    assert.equal(C.applyAction(restored, { type: 'mark', x: 0, y: 0, elapsed: a.session.elapsed, marks: true }), false);
    const history = C.addHistory([], a.session);
    assert.deepEqual(C.readHistory(JSON.stringify(history)), history);
    const forged = clone(history); forged[0].result = won ? 'lost' : 'won';
    assert.throws(() => C.readHistory(JSON.stringify(forged)));
  }
});

test('strict saved action and session validation rejects malformed or impossible data', () => {
  const a = attempt(); a.act('mark', 0, 5);
  const cases = [s => s.version = 2, s => s.id = '<script>', s => s.extra = 0,
    s => s.elapsed = -1, s => s.elapsed = 0.5, s => s.elapsed = null, s => s.elapsed = C.LIMITS.elapsed + 1,
    s => s.elapsed = 4, s => s.marks = false, s => s.actions[0].marks = false,
    s => s.actions[0].elapsed = -1, s => s.actions[0].elapsed = 1.5,
    s => s.actions[0].x = 9, s => s.actions[0].y = '0', s => s.actions[0].type = 'execute',
    s => s.actions[0].extra = [], s => s.actions[0].x = 4, // center row? set below explicitly
    s => s.actions = Array(C.LIMITS.actions + 1).fill(s.actions[0])];
  // Revealed center cannot be marked.
  cases[cases.length - 2] = s => { s.actions[0].x = 4; s.actions[0].y = 4; };
  for (const mutate of cases) {
    const s = clone(a.session); mutate(s);
    assert.throws(() => C.readSession(JSON.stringify(s)), JSON.stringify(s).slice(0, 200));
  }
  const nonmonotonic = clone(a.session);
  nonmonotonic.actions.push({ ...nonmonotonic.actions[0], elapsed: 4 });
  assert.throws(() => C.validateSession(nonmonotonic));
  const terminal = finish(attempt()); terminal.actions.push({ type: 'mark', x: 0, y: 0, marks: true, elapsed: terminal.elapsed });
  assert.throws(() => C.validateSession(terminal));
  for (const raw of ['{', 'null', '[]', '{}', 'x'.repeat(C.LIMITS.session + 1)]) assert.throws(() => C.readSession(raw));
  assert.throws(() => C.boundedJSON('xx', 1));
});

test('history retains newest 30 and aggregate byte budget, deduplicates attempts and rejects corrupt results', () => {
  const session = finish(attempt());
  let history = [];
  for (let n = 0; n < 35; n++) history = C.addHistory(history, { ...session, id: 'attempt-' + n });
  assert.equal(history.length, 30); assert.equal(history[0].session.id, 'attempt-5');
  history = C.addHistory(history, { ...session, id: 'attempt-34' });
  assert.equal(history.length, 30);
  assert.throws(() => C.readHistory(JSON.stringify([...history, history[0]])));
  assert.throws(() => C.readHistory(JSON.stringify([{ session, result: 'playing' }])));
  assert.throws(() => C.addHistory([], attempt().session));
  for (const raw of ['{}', '[null]', '[{}]', 'x'.repeat(C.LIMITS.history + 1)]) assert.throws(() => C.readHistory(raw));
  // Large valid finished attempts exercise aggregate retention independently of count.
  const a = attempt();
  for (let n = 0; n < 4000; n++) a.act('marks', null, 0);
  finish(a);
  let large = [];
  for (let n = 0; n < 30; n++) large = C.addHistory(large, { ...a.session, id: 'large-' + n });
  assert.ok(large.length < 30 && large.length > 0);
  assert.ok(JSON.stringify(large).length <= C.LIMITS.history);
  assert.equal(large.at(-1).session.id, 'large-29');
  assert.equal(C.readHistory(JSON.stringify(large)).length, large.length);
});
