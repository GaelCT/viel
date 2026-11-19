'use strict';

// DOM glue between the pure engine (window.MinesweeperEngine) and the static
// shell in index.html. Owns all DOM state; the engine game object lives in
// the module-level `game` below (the engine has no serialize/restore).

(function () {
  const Engine = window.MinesweeperEngine;
  const Challenge = window.MinesweeperChallenge;
  const $ = id => document.getElementById(id);

  // --- DOM references -------------------------------------------------------
  const board = document.getElementById('board');
  const smiley = document.getElementById('smiley');
  const mineCounterEl = document.getElementById('mine-counter');
  const timerEl = document.getElementById('timer');
  const marksItem = document.querySelector('[data-action="marks"]');
  const dialogCustom = document.getElementById('dialog-custom');
  const inputHeight = document.getElementById('custom-height');
  const inputWidth = document.getElementById('custom-width');
  const inputMines = document.getElementById('custom-mines');
  const dialogBest = document.getElementById('dialog-best');
  const dialogAbout = document.getElementById('dialog-about');
  const dialogHelp = document.getElementById('dialog-help');

  const BEST_KEY = 'minesweeper.best.v1';
  const SMILEY_STATES = ['normal', 'ooh', 'dead', 'cool'];

  // --- module state ---------------------------------------------------------
  let game = null;
  let cellEls = []; // parallel to game.cells, index-for-index, for O(1) updates
  let marksEnabled = marksItem.getAttribute('aria-checked') === 'true';
  let currentPreset = 'beginner';
  let currentConfig = {
    width: Engine.PRESETS.beginner.width,
    height: Engine.PRESETS.beginner.height,
    mines: Engine.PRESETS.beginner.mines
  };
  let pressedLook = []; // cell indices currently carrying the transient .pressed look
  let oohActive = false;
  let mode = 'classic';
  let session = null;
  let history = [];
  let replay = null;
  let clockBaseline = performance.now();
  let fractionalTime = 0;

  function notice(message) { $('challenge-notice').textContent = message; }
  function storage(method, key, value) {
    try { return window.localStorage[method](key, value); }
    catch (_) { notice('Local storage is unavailable. Play continues in memory; reload may lose progress.'); return null; }
  }
  function persist() {
    if (mode !== 'challenge' || !session) return;
    session.elapsed = game.elapsed;
    // The live session is created and extended only by the validated reducer.
    storage('setItem', Challenge.SESSION_KEY, Challenge.boundedJSON(session, Challenge.LIMITS.session));
  }
  function reflectMode() {
    const d = mode === 'replay' ? replay.source.descriptor : session && session.descriptor;
    $('challenge-status').textContent = mode === 'classic' ? 'Classic game' :
      (mode === 'replay' ? 'Replay: ' : 'Challenge: ') + d.date + ' UTC / ' + d.difficulty;
    $('replay-controls').hidden = mode !== 'replay';
    $('challenge-replay').hidden = mode !== 'challenge' || game.state === 'playing';
    smiley.disabled = mode === 'replay';
    for (const name of ['new', 'beginner', 'intermediate', 'expert', 'custom', 'marks', 'daily', 'import']) {
      document.querySelector('[data-action="' + name + '"]').disabled = mode === 'replay';
    }
    marksItem.setAttribute('aria-checked', String(marksEnabled));
    marksItem.querySelector('.check').textContent = marksEnabled ? '\u2713' : '';
  }
  function resetClock() { clockBaseline = performance.now(); fractionalTime = 0; }
  function updateClock() {
    const now = performance.now();
    if (mode === 'challenge' && game.state === 'playing' && !document.hidden) {
      fractionalTime += now - clockBaseline;
      const seconds = Math.floor(fractionalTime / 1000);
      if (seconds) {
        game.elapsed = Math.min(Challenge.LIMITS.elapsed, game.elapsed + seconds);
        fractionalTime %= 1000;
        persist();
        renderTimer(game.elapsed);
      }
    }
    clockBaseline = now;
  }
  function finishChallenge() {
    if (game.state === 'playing') return;
    history = Challenge.addHistory(history, session);
    storage('setItem', Challenge.HISTORY_KEY, JSON.stringify(history));
    reflectMode();
  }
  function challengeAction(type, i) {
    updateClock();
    if (session.actions.length >= Challenge.LIMITS.actions || game.elapsed >= Challenge.LIMITS.elapsed) {
      notice('This attempt reached its action or time limit. Restart the challenge to continue.');
      return;
    }
    const action = { type, elapsed: game.elapsed, marks: type === 'marks' ? !marksEnabled : marksEnabled };
    if (type !== 'marks') Object.assign(action, game.xy(i));
    const state = { game, marks: marksEnabled };
    if (!Challenge.applyAction(state, action)) return;
    session.actions.push(action);
    session.marks = marksEnabled = state.marks;
    persist();
    renderFull();
    finishChallenge();
  }
  function startChallenge(d) {
    const next = Challenge.newSession(d, marksEnabled);
    const nextGame = Challenge.createGame(next.descriptor);
    persist();
    mode = 'challenge';
    session = next;
    game = nextGame;
    currentPreset = null;
    resetClock();
    buildBoard();
    renderFull();
    persist();
    finishChallenge(); // Also handle a board completed by the automatic opening.
    reflectMode();
  }
  function restartGame() {
    if (mode === 'replay') return;
    if (mode === 'challenge') startChallenge(session.descriptor);
    else newGame(currentConfig);
  }

  // Replay owns a separate game and never invokes live persistence/completion.
  function enterReplay(source) {
    if (mode === 'replay') return;
    updateClock();
    persist();
    replay = { source: Challenge.validateSession(source), cursor: 0, playing: false,
      live: { game, mode, session, marksEnabled, currentPreset, currentConfig }, time: 0 };
    mode = 'replay';
    restartReplay();
    $('dialog-history').hidden = true;
  }
  function renderReplay() {
    $('replay-progress').textContent = replay.cursor + ' / ' + replay.source.actions.length +
      ' actions; ' + game.elapsed + ' / ' + replay.source.elapsed + ' seconds';
    $('replay-play').disabled = replay.playing || replay.cursor === replay.source.actions.length;
    $('replay-pause').disabled = !replay.playing;
    $('replay-step').disabled = replay.cursor === replay.source.actions.length;
    renderFull();
    reflectMode();
  }
  function restartReplay() {
    replay.playing = false;
    replay.cursor = 0;
    replay.time = 0;
    game = Challenge.createGame(replay.source.descriptor);
    marksEnabled = replay.source.initialMarks;
    buildBoard();
    renderReplay();
  }
  function stepReplay() {
    if (replay.cursor >= replay.source.actions.length) return;
    const state = { game, marks: marksEnabled };
    const action = replay.source.actions[replay.cursor++];
    Challenge.applyAction(state, action);
    marksEnabled = state.marks;
    replay.time = game.elapsed;
    if (replay.cursor === replay.source.actions.length) {
      game.elapsed = replay.source.elapsed;
      replay.playing = false;
    }
    renderReplay();
  }
  function exitReplay() {
    const live = replay.live;
    game = live.game; mode = live.mode; session = live.session;
    marksEnabled = live.marksEnabled; currentPreset = live.currentPreset; currentConfig = live.currentConfig;
    replay = null;
    resetClock();
    buildBoard(); renderFull(); reflectMode();
  }
  function renderHistory() {
    const list = $('history-list');
    list.textContent = '';
    if (!history.length) list.textContent = 'No finished challenges stored.';
    for (const row of history.slice().reverse()) {
      const item = document.createElement('li');
      const d = row.session.descriptor;
      const text = document.createElement('span');
      text.textContent = d.date + ' / ' + d.difficulty + ' / ' + row.result + ' / ' + row.session.elapsed + ' seconds';
      const button = document.createElement('button');
      button.textContent = 'Replay';
      button.disabled = mode === 'replay';
      button.addEventListener('click', () => enterReplay(row.session));
      item.append(text, button); list.append(item);
    }
  }

  // --- smiley ---------------------------------------------------------------
  function setSmiley(state) {
    for (const s of SMILEY_STATES) smiley.classList.toggle(s, s === state);
  }

  // Ooh while any mouse button is held over the board; back to the state that
  // matches the game (normal in play, dead/cool after game over) on release.
  function setOoh(on) {
    if (on) {
      if (oohActive || !game || game.state === 'won' || game.state === 'lost') return;
      oohActive = true;
      setSmiley('ooh');
    } else {
      if (!oohActive) return;
      oohActive = false;
      setSmiley(game.state === 'lost' ? 'dead' : game.state === 'won' ? 'cool' : 'normal');
    }
  }

  // --- LED displays ---------------------------------------------------------
  function renderLed(el, value) {
    const slots = el.querySelectorAll('.digit');
    let text;
    if (value < 0) {
      text = '-' + String(Math.min(99, -value)).padStart(2, '0');
    } else {
      text = String(Math.min(999, value)).padStart(3, '0');
    }
    for (let i = 0; i < slots.length; i++) {
      slots[i].setAttribute('data-digit', text[i] || '0');
    }
  }

  function renderCounter() {
    renderLed(mineCounterEl, game.displayCounter());
  }

  function renderTimer(value) {
    renderLed(timerEl, Math.min(999, value));
  }

  // --- transient pressed look ------------------------------------------------
  function addPressed(indices) {
    for (const i of indices) {
      if (cellEls[i]) {
        cellEls[i].classList.add('pressed');
        pressedLook.push(i);
      }
    }
  }

  function clearPressed() {
    for (const i of pressedLook) {
      if (cellEls[i]) cellEls[i].classList.remove('pressed');
    }
    pressedLook = [];
  }

  // --- cell rendering --------------------------------------------------------
  function renderRevealed(indices) {
    for (const i of indices) {
      const c = game.cells[i];
      const el = cellEls[i];
      el.classList.remove('covered', 'flagged', 'question', 'pressed');
      el.classList.add('revealed');
      el.textContent = c.adjacent > 0 ? String(c.adjacent) : '';
      if (c.adjacent > 0) el.classList.add('n' + c.adjacent);
    }
  }

  function renderLost(ev) {
    for (const i of ev.mines) {
      const el = cellEls[i];
      el.classList.remove('covered', 'flagged', 'question', 'pressed');
      el.classList.add('revealed', 'mine');
    }
    cellEls[ev.exploded].classList.add('exploded');
    for (const i of ev.wrongFlags) {
      const el = cellEls[i];
      el.classList.remove('covered', 'flagged', 'question', 'pressed');
      el.classList.add('revealed', 'wrongflag');
    }
    setSmiley('dead');
  }

  function renderWon() {
    for (let i = 0; i < game.cells.length; i++) {
      if (!game.cells[i].mine) continue;
      const el = cellEls[i];
      el.classList.remove('covered', 'question', 'pressed');
      el.classList.add('flagged');
    }
    setSmiley('cool');
  }

  function renderFlagCell(i) {
    const c = game.cells[i];
    const el = cellEls[i];
    el.classList.toggle('flagged', c.flagged);
    el.classList.toggle('question', !c.flagged && c.question);
  }

  function applyEvents(events) {
    for (const ev of events) {
      if (ev.type === 'revealed') renderRevealed(ev.cells);
      else if (ev.type === 'lost') renderLost(ev);
      else if (ev.type === 'won') {
        renderWon();
        onWin();
      }
    }
  }

  // --- game lifecycle --------------------------------------------------------
  function newGame(config, initializing = false) {
    persist();
    mode = 'classic';
    session = null;
    if (!initializing) storage('removeItem', Challenge.SESSION_KEY);
    game = Engine.createGame(config);
    currentConfig = { width: config.width, height: config.height, mines: config.mines };
    buildBoard();
    reflectMode();
  }

  function buildBoard() {
    board.style.setProperty('--cols', String(game.width));
    board.style.setProperty('--rows', String(game.height));
    board.textContent = '';
    cellEls = new Array(game.cells.length);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < game.cells.length; i++) {
      const el = document.createElement('div');
      el.className = 'cell covered';
      el.dataset.index = String(i);
      frag.appendChild(el);
      cellEls[i] = el;
    }
    board.appendChild(frag);
    pressedLook = [];
    oohActive = false;
    setSmiley('normal');
    renderCounter();
    renderTimer(0);
    reflectDifficulty();
  }

  function renderFull() {
    for (let i = 0; i < game.cells.length; i++) {
      const c = game.cells[i];
      const el = cellEls[i];
      el.className = 'cell covered';
      el.textContent = '';
      if (c.revealed) renderRevealed([i]);
      else renderFlagCell(i);
    }
    if (game.state === 'lost') renderLost({
      mines: game.cells.flatMap((c, i) => c.mine ? [i] : []),
      wrongFlags: game.cells.flatMap((c, i) => c.flagged && !c.mine ? [i] : []),
      exploded: game.cells.findIndex(c => c.exploded)
    });
    else if (game.state === 'won') renderWon();
    else setSmiley('normal');
    renderCounter(); renderTimer(game.elapsed);
    reflectMode();
  }

  // --- board input -----------------------------------------------------------
  function xyOf(i) {
    const p = game.xy(i);
    return [p.x, p.y];
  }

  function cellIndexFromEvent(e) {
    if (!(e.target instanceof Element)) return -1;
    const el = e.target.closest('.cell');
    return el ? Number(el.dataset.index) : -1;
  }

  function gameIsOver() {
    return mode === 'replay' || !game || game.state === 'won' || game.state === 'lost';
  }

  function onBoardClick(e) {
    clearPressed();
    if (gameIsOver()) return;
    const i = cellIndexFromEvent(e);
    if (i < 0) return;
    const c = game.cells[i];
    if (mode === 'challenge') {
      challengeAction(c.revealed ? 'chord' : 'reveal', i);
      return;
    }
    if (c.revealed) {
      // left-click on a revealed number chords it
      if (c.adjacent > 0) applyEvents(game.chord(...xyOf(i)).events);
    } else if (!c.flagged) {
      applyEvents(game.reveal(...xyOf(i)).events);
    }
  }

  function onBoardContextMenu(e) {
    e.preventDefault();
    if (gameIsOver()) return;
    const i = cellIndexFromEvent(e);
    if (i < 0) return;
    if (mode === 'challenge') { challengeAction('mark', i); return; }
    game.toggleFlag(...xyOf(i));
    // Marks (?) option: the engine always cycles covered -> flag -> question.
    // When marks are disabled we skip the question stop: if the first toggle
    // landed on question (i.e. it came from a flag), toggle once more to
    // advance straight back to covered.
    if (!marksEnabled && game.cells[i].question) game.toggleFlag(...xyOf(i));
    renderFlagCell(i);
    renderCounter();
  }

  function onBoardMouseDown(e) {
    if (gameIsOver()) return;
    setOoh(true);
    const i = cellIndexFromEvent(e);
    if (i < 0) return;
    const c = game.cells[i];
    if (c.revealed) {
      // press-look on the neighbors a chord would reveal
      if (c.adjacent > 0) addPressed(game.chordPreview(...xyOf(i)));
    } else if (!c.flagged) {
      addPressed([i]);
    }
  }

  function onBoardMouseLeave() {
    clearPressed();
    setOoh(false);
  }

  function onWindowMouseUp() {
    clearPressed();
    setOoh(false);
  }

  // --- menus -----------------------------------------------------------------
  function closeAllMenus() {
    document.querySelectorAll('.menu-trigger').forEach(t => t.setAttribute('aria-expanded', 'false'));
    document.querySelectorAll('ul.menu').forEach(m => { m.hidden = true; });
  }

  function toggleMenu(trigger) {
    const menu = trigger.parentElement.querySelector('ul.menu');
    const willOpen = trigger.getAttribute('aria-expanded') !== 'true';
    closeAllMenus();
    if (willOpen) {
      trigger.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
    }
  }

  function toggleMarks() {
    if (mode === 'replay') return;
    if (mode === 'challenge' && game.state === 'playing') { challengeAction('marks'); return; }
    if (mode === 'challenge') return;
    marksEnabled = !marksEnabled;
    marksItem.setAttribute('aria-checked', marksEnabled ? 'true' : 'false');
    const check = marksItem.querySelector('.check');
    if (check) check.textContent = marksEnabled ? '✓' : '';
  }

  // Show a check mark next to the active difficulty item (beginner /
  // intermediate / expert / custom). The HTML check column exists on every
  // item, so this costs nothing; Marks (?) keeps its own independent toggle.
  function reflectDifficulty() {
    document.querySelectorAll('[data-action]').forEach(btn => {
      const a = btn.dataset.action;
      if (a !== 'beginner' && a !== 'intermediate' && a !== 'expert' && a !== 'custom') return;
      const active = a === currentPreset;
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
      const check = btn.querySelector('.check');
      if (check) check.textContent = active ? '✓' : '';
    });
  }

  function runAction(action) {
    if (mode === 'replay' && ['new', 'beginner', 'intermediate', 'expert', 'custom', 'marks', 'daily', 'import'].includes(action)) return;
    switch (action) {
      case 'new':
        restartGame();
        break;
      case 'daily':
        $('daily-date').textContent = Challenge.utcDate() + ' (UTC)';
        $('dialog-daily').hidden = false;
        break;
      case 'share':
        if (mode === 'classic') { notice('Start a Daily Challenge before sharing a code.'); break; }
        $('challenge-code').value = Challenge.code(mode === 'replay' ? replay.source.descriptor : session.descriptor);
        $('copy-status').textContent = 'Select the code and copy with Ctrl+C (or your device copy command).';
        $('dialog-share').hidden = false;
        break;
      case 'import':
        $('import-error').textContent = '';
        $('dialog-import').hidden = false;
        break;
      case 'history':
        renderHistory(); $('dialog-history').hidden = false;
        break;
      case 'beginner':
      case 'intermediate':
      case 'expert':
        currentPreset = action;
        newGame(Engine.PRESETS[action]);
        break;
      case 'custom':
        openCustomDialog();
        break;
      case 'marks':
        toggleMarks();
        break;
      case 'best':
        renderBestTimes();
        dialogBest.hidden = false;
        break;
      case 'exit':
        try { window.close(); } catch (err) { /* not script-opened: close is a no-op */ }
        break;
      case 'help':
        dialogHelp.hidden = false;
        break;
      case 'about':
        dialogAbout.hidden = false;
        break;
    }
  }

  // --- custom dialog -----------------------------------------------------------
  function clampInt(value, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return NaN;
    return Math.max(min, Math.min(max, n));
  }

  function openCustomDialog() {
    inputHeight.value = String(currentConfig.height);
    inputWidth.value = String(currentConfig.width);
    inputMines.value = String(currentConfig.mines);
    dialogCustom.hidden = false;
  }

  function onCustomOk() {
    const w = clampInt(inputWidth.value, 8, 30);
    const h = clampInt(inputHeight.value, 8, 24);
    let m = NaN;
    const rawMines = Number(inputMines.value);
    if (Number.isFinite(rawMines)) m = Math.max(10, Math.min(w * h - 1, Math.round(rawMines)));
    try {
      Engine.validateConfig(w, h, m);
    } catch (err) {
      alert('Invalid field. Height must be 8-24, width 8-30, mines 10 to (width x height - 1).');
      return;
    }
    currentPreset = 'custom';
    dialogCustom.hidden = true;
    newGame({ width: w, height: h, mines: m });
  }

  // --- best times ---------------------------------------------------------------
  function loadBestTimes() {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function storeBestTimes(data) {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(data)); } catch (err) { /* storage unavailable */ }
  }

  function renderBestTimes() {
    const best = loadBestTimes();
    [['beginner', 'best-beginner'], ['intermediate', 'best-intermediate'], ['expert', 'best-expert']].forEach(pair => {
      const row = document.getElementById(pair[1]);
      const rec = best[pair[0]];
      row.querySelector('.best-time').textContent = rec && typeof rec.time === 'number' ? String(rec.time) : '999';
      row.querySelector('.best-name').textContent = rec && rec.name ? String(rec.name) : '---';
    });
  }

  function onWin() {
    renderCounter();
    if (mode !== 'classic') return;
    if (currentPreset !== 'beginner' && currentPreset !== 'intermediate' && currentPreset !== 'expert') return;
    const best = loadBestTimes();
    const prev = best[currentPreset];
    if (prev && typeof prev.time === 'number' && game.elapsed >= prev.time) return;
    let name = null;
    try {
      name = prompt('You have the fastest time for ' + currentPreset + ' level.\nPlease enter your name:', 'Anonymous');
    } catch (err) {
      name = null;
    }
    if (name === null) return; // prompt cancelled: keep the old record
    best[currentPreset] = { time: game.elapsed, name: name === '' ? 'Anonymous' : name };
    storeBestTimes(best);
  }

  // --- wiring -------------------------------------------------------------------
  smiley.addEventListener('click', restartGame);

  board.addEventListener('click', onBoardClick);
  board.addEventListener('contextmenu', onBoardContextMenu);
  board.addEventListener('mousedown', onBoardMouseDown);
  board.addEventListener('mouseleave', onBoardMouseLeave);
  window.addEventListener('mouseup', onWindowMouseUp);

  document.querySelectorAll('.menu-trigger').forEach(trigger => {
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      toggleMenu(trigger);
    });
  });

  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeAllMenus();
      runAction(btn.dataset.action);
    });
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.menu-wrap')) closeAllMenus();
  });

  document.getElementById('custom-ok').addEventListener('click', onCustomOk);
  document.getElementById('custom-cancel').addEventListener('click', () => { dialogCustom.hidden = true; });
  document.getElementById('best-reset').addEventListener('click', () => {
    storeBestTimes({});
    renderBestTimes();
  });
  document.getElementById('best-ok').addEventListener('click', () => { dialogBest.hidden = true; });
  document.getElementById('about-ok').addEventListener('click', () => { dialogAbout.hidden = true; });
  document.getElementById('help-ok').addEventListener('click', () => { dialogHelp.hidden = true; });

  $('daily-start').addEventListener('click', () => {
    startChallenge(Challenge.daily(Challenge.utcDate(), $('daily-difficulty').value));
    $('dialog-daily').hidden = true;
  });
  $('import-start').addEventListener('click', () => {
    try {
      const d = Challenge.decode($('import-code').value);
      startChallenge(d);
      $('dialog-import').hidden = true;
    } catch (error) { $('import-error').textContent = error.message; }
  });
  $('challenge-copy').addEventListener('click', async () => {
    const field = $('challenge-code');
    field.focus(); field.select();
    try {
      await navigator.clipboard.writeText(field.value);
      $('copy-status').textContent = 'Code copied.';
    } catch (_) { $('copy-status').textContent = 'Copy is unavailable. The code is selected: press Ctrl+C or use your device copy command.'; }
  });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
    $(button.dataset.close).hidden = true;
  }));
  $('history-clear').addEventListener('click', () => {
    history = []; storage('removeItem', Challenge.HISTORY_KEY); renderHistory();
  });
  $('challenge-replay').addEventListener('click', () => enterReplay(session));
  $('replay-step').addEventListener('click', () => { replay.playing = false; stepReplay(); });
  $('replay-restart').addEventListener('click', restartReplay);
  $('replay-play').addEventListener('click', () => {
    replay.playing = true; replay.baseline = performance.now(); renderReplay();
  });
  $('replay-pause').addEventListener('click', () => { replay.playing = false; renderReplay(); });
  $('replay-exit').addEventListener('click', exitReplay);
  setInterval(() => {
    if (mode === 'challenge') { updateClock(); return; }
    if (mode !== 'replay' || !replay.playing) return;
    const now = performance.now();
    replay.time += (now - replay.baseline) / 1000;
    replay.baseline = now;
    // At most one move per frame, so even simultaneous moves can be inspected.
    const next = replay.source.actions[replay.cursor];
    if (next && next.elapsed <= replay.time) {
      const time = replay.time;
      stepReplay();
      replay.time = time;
    }
  }, 100);
  window.addEventListener('pagehide', () => { updateClock(); persist(); });
  document.addEventListener('visibilitychange', () => {
    // Hidden time is paused; page exit and reload cannot count offline time.
    resetClock(); persist();
  });
  // Classic keeps its existing capped clock. Challenges keep full active seconds.
  setInterval(() => {
    if (mode === 'classic' && game && game.state === 'playing') {
      game.tick();
      renderTimer(game.elapsed);
    }
  }, 1000);

  newGame(currentConfig, true);
  const savedHistory = storage('getItem', Challenge.HISTORY_KEY);
  if (savedHistory) {
    try { history = Challenge.readHistory(savedHistory); }
    catch (_) { notice('Saved challenge history is corrupt or unsupported. Start a new challenge or clear history.'); }
  }
  const savedSession = storage('getItem', Challenge.SESSION_KEY);
  if (savedSession) {
    try {
      const restored = Challenge.readSession(savedSession);
      const state = Challenge.reconstruct(restored);
      session = restored; game = state.game; marksEnabled = state.marks;
      mode = 'challenge'; currentPreset = null;
      resetClock(); buildBoard(); renderFull();
    } catch (_) { notice('Saved challenge is corrupt or unsupported. You can start a new Daily Challenge.'); }
  }
})();
