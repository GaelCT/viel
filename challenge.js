'use strict';

// V1 contract: FNV-1a identity seed, Mulberry32, engine Fisher-Yates placement.
// Changing any of these requires a new version, never a silent V1 migration.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./engine.js'));
  else root.MinesweeperChallenge = factory(root.MinesweeperEngine);
})(typeof window !== 'undefined' ? window : globalThis, function (Engine) {
  const VERSION = 1;
  const SESSION_KEY = 'minesweeper.challenge.session.v1';
  const HISTORY_KEY = 'minesweeper.challenge.history.v1';
  const LIMITS = Object.freeze({ code: 512, actions: 4096, elapsed: 31536000,
    session: 512 * 1024, history: 2 * 1024 * 1024, records: 30 });
  const fail = message => { throw new Error(message); };
  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) fail('Unexpected or missing fields.');
  }
  function integer(value, max, name) {
    if (!Number.isInteger(value) || value < 0 || value > max) fail('Invalid ' + name + '.');
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' ||
        !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
        new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail('Use a real UTC date (YYYY-MM-DD).');
    return value;
  }
  function utcDate(now = new Date()) {
    return validDate(now.toISOString().slice(0, 10));
  }
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
    return h;
  }
  function daily(date = utcDate(), difficulty = 'beginner') {
    validDate(date);
    if (typeof difficulty !== 'string' || !Object.hasOwn(Engine.PRESETS, difficulty)) fail('Choose beginner, intermediate or expert.');
    const p = Engine.PRESETS[difficulty];
    return { version: VERSION, date, difficulty, seed: hash('MSD1|' + date + '|' + difficulty),
      opening: { x: Math.floor(p.width / 2), y: Math.floor(p.height / 2) } };
  }
  function descriptor(value) {
    exact(value, ['version', 'date', 'difficulty', 'seed', 'opening']);
    if (value.version !== VERSION) fail('Unsupported challenge version.');
    validDate(value.date);
    if (typeof value.difficulty !== 'string') fail('Invalid challenge difficulty.');
    const expected = daily(value.date, value.difficulty);
    integer(value.seed, 0xffffffff, 'seed');
    exact(value.opening, ['x', 'y']);
    if (value.seed !== expected.seed || value.opening.x !== expected.opening.x || value.opening.y !== expected.opening.y)
      fail('Challenge seed or opening does not match its daily identity.');
    return expected;
  }
  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function createGame(value) {
    const d = descriptor(value);
    const game = Engine.createGame({ ...Engine.PRESETS[d.difficulty], rng: rng(d.seed) });
    game.reveal(d.opening.x, d.opening.y);
    return game;
  }
  function code(value) {
    const d = descriptor(value);
    const body = ['MSD1', d.date, d.difficulty, d.seed, d.opening.x, d.opening.y].join('|');
    return body + '|' + hash(body).toString(16).padStart(8, '0');
  }
  function decode(value) {
    if (typeof value !== 'string' || value.length > LIMITS.code) fail('Challenge code is too long (maximum 512 characters).');
    const parts = value.trim().split('|');
    if (parts.length !== 7 || parts[0] !== 'MSD1') fail('Use a supported MSD1 challenge code.');
    const body = parts.slice(0, 6).join('|');
    if (hash(body).toString(16).padStart(8, '0') !== parts[6]) fail('Challenge code checksum failed. Copy the entire code again.');
    const d = descriptor({ version: 1, date: parts[1], difficulty: parts[2], seed: Number(parts[3]),
      opening: { x: Number(parts[4]), y: Number(parts[5]) } });
    if (code(d) !== value.trim()) fail('Challenge code is not canonical.');
    return d;
  }
  function newSession(value, marks = true, id) {
    if (typeof marks !== 'boolean') fail('Invalid marks setting.');
    // Identity is local attempt bookkeeping, not part of the shared board seed.
    id = id || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14));
    return { version: VERSION, id, descriptor: descriptor(value), initialMarks: marks, marks,
      actions: [], elapsed: 0 };
  }
  function applyAction(state, action) {
    const g = state.game;
    exact(action, action && action.type === 'marks' ? ['type', 'elapsed', 'marks'] : ['type', 'x', 'y', 'elapsed', 'marks']);
    integer(action.elapsed, LIMITS.elapsed, 'action time');
    if (action.elapsed < g.elapsed || typeof action.marks !== 'boolean') fail('Invalid action time or marks setting.');
    if (g.state !== 'playing') return false;
    if (action.type === 'marks') {
      if (action.marks === state.marks) return false;
      state.marks = action.marks;
    } else {
      integer(action.x, g.width - 1, 'column');
      integer(action.y, g.height - 1, 'row');
      if (action.marks !== state.marks) fail('Action marks setting is inconsistent.');
      const c = g.cells[g.idx(action.x, action.y)];
      if (action.type === 'mark') {
        if (c.revealed) return false;
        g.toggleFlag(action.x, action.y);
        if (!state.marks && c.question) g.toggleFlag(action.x, action.y);
      } else if (action.type === 'reveal' || action.type === 'chord') {
        const events = g[action.type](action.x, action.y).events;
        if (!events.length) return false;
      } else fail('Unknown challenge action.');
    }
    g.elapsed = action.elapsed;
    return true;
  }
  function reconstruct(session, count = session.actions.length) {
    const state = { game: createGame(session.descriptor), marks: session.initialMarks };
    for (const action of session.actions.slice(0, count)) {
      if (!applyAction(state, action)) fail('Saved action is impossible or follows a finished game.');
    }
    if (count === session.actions.length) state.game.elapsed = session.elapsed;
    return state;
  }
  function validateSession(value) {
    exact(value, ['version', 'id', 'descriptor', 'initialMarks', 'marks', 'actions', 'elapsed']);
    if (value.version !== VERSION) fail('Unsupported saved-game version.');
    if (typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(value.id)) fail('Invalid attempt identifier.');
    const d = descriptor(value.descriptor);
    if (typeof value.initialMarks !== 'boolean' || typeof value.marks !== 'boolean') fail('Invalid saved marks setting.');
    integer(value.elapsed, LIMITS.elapsed, 'elapsed time');
    if (!Array.isArray(value.actions) || value.actions.length > LIMITS.actions) fail('Too many saved actions.');
    const state = { game: createGame(d), marks: value.initialMarks };
    for (const a of value.actions) if (!applyAction(state, a)) fail('Saved action is impossible or follows a finished game.');
    if (state.marks !== value.marks || value.elapsed < state.game.elapsed ||
        (state.game.state !== 'playing' && value.elapsed !== state.game.elapsed)) fail('Saved time or marks do not match the actions.');
    // Return owned data, never retain caller-controlled references.
    return JSON.parse(JSON.stringify(value));
  }
  // ASCII-only schemas make length an exact UTF-8 byte count for valid saves.
  function boundedJSON(value, max) {
    const raw = JSON.stringify(value);
    if (raw.length > max) fail('Local challenge data exceeds its storage limit.');
    return raw;
  }
  function parseJSON(raw, max) {
    if (typeof raw !== 'string' || raw.length > max) fail('Saved challenge data is missing or too large.');
    try { return JSON.parse(raw); } catch (_) { fail('Saved challenge data is not valid JSON.'); }
  }
  function readSession(raw) { return validateSession(parseJSON(raw, LIMITS.session)); }
  function writeSession(value) { return boundedJSON(validateSession(value), LIMITS.session); }
  function readHistory(raw) {
    const values = parseJSON(raw, LIMITS.history);
    if (!Array.isArray(values) || values.length > LIMITS.records) fail('Invalid history size.');
    const ids = new Set();
    return values.map(value => {
      exact(value, ['session', 'result']);
      const session = validateSession(value.session);
      const result = reconstruct(session).game.state;
      if (!['won', 'lost'].includes(result) || value.result !== result || ids.has(session.id)) fail('Invalid or duplicate history result.');
      ids.add(session.id);
      return { session, result };
    });
  }
  function addHistory(history, session) {
    const owned = validateSession(session);
    const result = reconstruct(owned).game.state;
    if (!['won', 'lost'].includes(result)) fail('Only finished games belong in history.');
    const next = [...history.filter(r => r.session.id !== owned.id), { session: owned, result }].slice(-LIMITS.records);
    while (JSON.stringify(next).length > LIMITS.history) next.shift();
    return next;
  }
  return { VERSION, SESSION_KEY, HISTORY_KEY, LIMITS, hash, rng, utcDate, daily, descriptor,
    createGame, code, decode, newSession, applyAction, reconstruct, validateSession,
    readSession, writeSession, readHistory, addHistory, boundedJSON };
});
