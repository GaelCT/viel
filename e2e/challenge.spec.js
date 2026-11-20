const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const C = require('../challenge');
const fixed = C.daily('2026-01-01');
const cells = page => page.locator('#board .cell');
const cell = (page, i) => cells(page).nth(i);
async function menu(page, action) {
  await page.getByRole('button', { name: 'Game', exact: true }).click();
  await page.locator('[data-action="' + action + '"]').click();
}
async function importCode(page, code = C.code(fixed)) {
  await menu(page, 'import');
  await page.getByLabel('Paste challenge code').fill(code);
  await page.getByRole('button', { name: 'Import and start', exact: true }).click();
  await expect(page.locator('#dialog-import')).toBeHidden();
}
async function boardState(page) {
  return cells(page).evaluateAll(els => els.map(el => ({ class: el.className, text: el.textContent })));
}
async function led(page, id) {
  return page.locator('#' + id + ' .digit').evaluateAll(els => els.map(el => el.dataset.digit).join(''));
}
async function stored(page, key) { return page.evaluate(key => localStorage.getItem(key), key); }

test('daily uses UTC, identical restart and shared code in a fresh context; manual copy fallback', async ({ page, browser }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await page.goto('/');
  await menu(page, 'daily');
  await expect(page.getByLabel('Challenge difficulty')).toBeVisible();
  await page.getByLabel('Challenge difficulty').selectOption('intermediate');
  await page.getByRole('button', { name: 'Start challenge', exact: true }).click();
  const today = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  await expect(page.locator('#challenge-status')).toHaveText('Challenge: ' + today + ' UTC / intermediate');
  const initial = await boardState(page);
  const oracle = C.createGame(C.daily(today, 'intermediate'));
  const covered = oracle.cells.findIndex(c => !c.revealed);
  await cell(page, covered).click({ button: 'right' });
  await page.locator('#smiley').click();
  expect(await boardState(page)).toEqual(initial);
  await menu(page, 'new');
  expect(await boardState(page)).toEqual(initial);
  await menu(page, 'daily');
  await page.getByRole('button', { name: 'Start challenge', exact: true }).click();
  expect(await boardState(page)).toEqual(initial);
  await menu(page, 'share');
  const code = await page.getByLabel('Challenge code', { exact: true }).inputValue();
  expect(C.decode(code)).toEqual(C.daily(today, 'intermediate'));
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(page.locator('#copy-status')).toContainText('press Ctrl+C');
  expect(await page.locator('#challenge-code').evaluate(el => el.selectionEnd - el.selectionStart)).toBe(code.length);
  await page.locator('[data-close="dialog-share"]').click();
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto(page.url());
    await importCode(other, code);
    expect(await boardState(other)).toEqual(initial);
    const safe = oracle.cells.findIndex(c => !c.mine && !c.revealed);
    const mine = oracle.cells.findIndex(c => c.mine);
    for (const p of [page, other]) {
      await cell(p, covered).click({ button: 'right' });
      await cell(p, covered).click({ button: 'right' });
      await cell(p, covered).click({ button: 'right' });
      await cell(p, safe).click(); await cell(p, mine).click();
      await expect(p.locator('#smiley')).toHaveClass(/dead/);
    }
    expect(await boardState(other)).toEqual(await boardState(page));
  } finally { await context.close(); }
});

test('golden mine placement and invalid imports leave current state intact', async ({ page }) => {
  await page.goto('/'); await importCode(page);
  await cell(page, 0).click({ button: 'right' });
  const before = await boardState(page);
  const attempt = JSON.parse(await stored(page, C.SESSION_KEY)).id;
  for (const code of ['<script>window.bad=true</script>', 'x'.repeat(513), C.code(fixed).replace('2026', '2027'), 'MSD2|bad']) {
    await menu(page, 'import'); await page.getByLabel('Paste challenge code').fill(code);
    await page.getByRole('button', { name: 'Import and start', exact: true }).click();
    await expect(page.locator('#import-error')).not.toBeEmpty();
    expect(await boardState(page)).toEqual(before);
    expect(JSON.parse(await stored(page, C.SESSION_KEY)).id).toBe(attempt);
    await page.locator('[data-close="dialog-import"]').click();
  }
  expect(await page.evaluate(() => window.bad)).toBeUndefined();
  await cell(page, 4).click();
  expect(await page.locator('#board .mine').evaluateAll(els => els.map(el => Number(el.dataset.index))))
    .toEqual([4,5,11,12,28,29,33,76,79,80]);
  await expect(page.locator('#smiley')).toHaveClass(/dead/);
});

test('reload restores question marks, disabled marks, counter and active time without offline time', async ({ page }) => {
  await page.clock.install();
  await page.goto('/'); await importCode(page);
  await cell(page, 0).click({ button: 'right' });
  await cell(page, 0).click({ button: 'right' });
  await cell(page, 4).click({ button: 'right' });
  await menu(page, 'marks');
  await page.clock.runFor(3200);
  const before = await boardState(page);
  const time = JSON.parse(await stored(page, C.SESSION_KEY)).elapsed;
  expect(time).toBeGreaterThanOrEqual(3);
  expect(await led(page, 'mine-counter')).toBe('009');
  // A detached page has no running app to add this closed time.
  await page.goto('about:blank');
  await page.clock.runFor(60000);
  await page.goto('http://127.0.0.1:4178/');
  expect(await boardState(page)).toEqual(before);
  expect(Number(await led(page, 'timer'))).toBe(time);
  expect(await led(page, 'mine-counter')).toBe('009');
  await expect(page.locator('[data-action="marks"]')).toHaveAttribute('aria-checked', 'false');
  await cell(page, 4).click({ button: 'right' });
  await expect(cell(page, 4)).not.toHaveClass(/flagged|question/);
  await page.reload();
  expect(await led(page, 'mine-counter')).toBe('010');
  await expect(cell(page, 0)).toHaveClass(/question/);
  await expect(cell(page, 4)).not.toHaveClass(/flagged|question/);
});

test('active fractions survive repeated visibility changes and elapsed seconds survive reload', async ({ page }) => {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.goto('/'); await importCode(page);
  const setHidden = hidden => page.evaluate(hidden => {
    // Simulate the visibility state already having changed when the browser
    // dispatches the event; the clock itself runs through real app handlers.
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  let active = 0;
  for (const duration of [600, 600, 950, 950, 950, 950]) {
    await page.clock.runFor(duration);
    active += duration;
    await setHidden(true);
    const seconds = Math.floor(active / 1000);
    expect(Number(await led(page, 'timer'))).toBe(seconds);
    expect(JSON.parse(await stored(page, C.SESSION_KEY)).elapsed).toBe(seconds);
    await page.clock.runFor(10000);
    expect(Number(await led(page, 'timer'))).toBe(seconds);
    await setHidden(false);
    expect(Number(await led(page, 'timer'))).toBe(seconds);
  }
  // The 50ms tails after the last ticks must also count: total active = 5s.
  expect(Number(await led(page, 'timer'))).toBe(5);
  await cell(page, 0).click({ button: 'right' });
  expect(JSON.parse(await stored(page, C.SESSION_KEY)).actions.at(-1).elapsed).toBe(5);
  await page.reload();
  expect(Number(await led(page, 'timer'))).toBe(5);
  expect(JSON.parse(await stored(page, C.SESSION_KEY)).elapsed).toBe(5);
  await expect(cell(page, 0)).toHaveClass(/flagged/);
});

test('UI win with marks and chord replays step/play/pause/restart/end, keeps history and classic records isolated', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('minesweeper.best.v1', JSON.stringify({ beginner: { time: 42, name: 'Classic' } })));
  const best = await stored(page, 'minesweeper.best.v1');
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
  await importCode(page);
  const g = C.createGame(fixed);
  for (let n = 0; n < 3; n++) { await cell(page, 0).click({ button: 'right' }); g.toggleFlag(0, 0); }
  await menu(page, 'marks');
  for (let n = 0; n < 2; n++) await cell(page, 4).click({ button: 'right' });
  await expect(cell(page, 4)).not.toHaveClass(/question|flagged/);
  await menu(page, 'marks');
  await page.clock.runFor(3000);
  // Prepare one legal chord using the independently instantiated deterministic board.
  const target = g.cells.findIndex((c, i) => c.revealed && c.adjacent > 0 &&
    g.neighbors(i).some(n => !g.cells[n].revealed && !g.cells[n].mine));
  for (const n of g.neighbors(target)) if (g.cells[n].mine) {
    await cell(page, n).click({ button: 'right' }); g.toggleFlag(n % 9, Math.floor(n / 9));
  }
  await cell(page, target).click(); g.chord(target % 9, Math.floor(target / 9));
  for (let i = 0; i < g.cells.length; i++) if (!g.cells[i].mine && !g.cells[i].revealed) {
    await cell(page, i).click(); g.reveal(i % 9, Math.floor(i / 9));
  }
  await expect(page.locator('#smiley')).toHaveClass(/cool/);
  const final = await boardState(page);
  const finalTime = await led(page, 'timer');
  const saved = JSON.parse(await stored(page, C.SESSION_KEY));
  expect(saved.actions.some(a => a.type === 'chord')).toBe(true);
  const resultHistory = await stored(page, C.HISTORY_KEY);
  expect(JSON.parse(resultHistory)).toHaveLength(1);
  expect(JSON.parse(resultHistory)[0].result).toBe('won');
  expect(dialogs).toEqual([]);
  expect(await stored(page, 'minesweeper.best.v1')).toBe(best);
  await page.getByRole('button', { name: 'Replay finished challenge', exact: true }).click();
  await expect(page.locator('#replay-controls')).toBeVisible();
  await expect(page.locator('#replay-progress')).toContainText('0 /');
  const initial = await boardState(page);
  await cell(page, 0).click({ button: 'right' });
  await cell(page, 4).click();
  expect(await boardState(page)).toEqual(initial);
  await expect(page.locator('#smiley')).toBeDisabled();
  for (const action of ['new', 'beginner', 'custom', 'marks', 'daily', 'import'])
    await expect(page.locator('[data-action="' + action + '"]')).toBeDisabled();
  await page.getByRole('button', { name: 'Step forward', exact: true }).click();
  await expect(cell(page, 0)).toHaveClass(/flagged/);
  await page.getByRole('button', { name: 'Step forward', exact: true }).click();
  await expect(cell(page, 0)).toHaveClass(/question/);
  await page.getByRole('button', { name: 'Restart replay', exact: true }).click();
  expect(await boardState(page)).toEqual(initial);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(200);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await boardState(page);
  const progress = await page.locator('#replay-progress').textContent();
  await page.clock.runFor(2000);
  expect(await boardState(page)).toEqual(paused);
  await expect(page.locator('#replay-progress')).toHaveText(progress);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(15000);
  expect(await boardState(page)).toEqual(final);
  expect(await led(page, 'timer')).toBe(finalTime);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await expect(page.locator('#replay-progress')).toContainText(saved.actions.length + ' / ' + saved.actions.length);
  await page.clock.runFor(10000);
  expect(await stored(page, C.SESSION_KEY)).toBe(JSON.stringify(saved));
  expect(await stored(page, C.HISTORY_KEY)).toBe(resultHistory);
  await page.getByRole('button', { name: 'Exit replay', exact: true }).click();
  expect(await boardState(page)).toEqual(final);
  await menu(page, 'best');
  await expect(page.locator('#best-beginner .best-time')).toHaveText('42');
  await page.locator('#best-ok').click();
  // A history replay temporarily suspends a different unfinished live challenge.
  await importCode(page, C.code(C.daily('2026-01-02')));
  const live = C.createGame(C.daily('2026-01-02'));
  const covered = live.cells.findIndex(c => !c.revealed);
  await cell(page, covered).click({ button: 'right' });
  const liveBoard = await boardState(page);
  const liveSave = await stored(page, C.SESSION_KEY);
  await menu(page, 'history');
  await expect(page.locator('#history-list')).toContainText('2026-01-01 / beginner / won');
  await page.locator('#history-list button').click();
  await menu(page, 'history');
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await page.locator('[data-close="dialog-history"]').click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(15000);
  await page.getByRole('button', { name: 'Exit replay', exact: true }).click();
  expect(await boardState(page)).toEqual(liveBoard);
  expect(await stored(page, C.SESSION_KEY)).toBe(liveSave);
  expect(await stored(page, C.HISTORY_KEY)).toBeNull();
  expect(await stored(page, 'minesweeper.best.v1')).toBe(best);
  expect(dialogs).toEqual([]);
  await menu(page, 'beginner');
  await expect(page.locator('#challenge-status')).toHaveText('Classic game');
  await expect(page.locator('#board .revealed')).toHaveCount(0);
  expect(await stored(page, C.SESSION_KEY)).toBeNull();
});

test('corrupt and impossible stored data show a warning and allow normal challenge play', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ sessionKey, historyKey }) => {
    localStorage.setItem(sessionKey, '{"actions":[{"type":"execute"}]}');
    localStorage.setItem(historyKey, '[{"result":"won"}]');
  }, { sessionKey: C.SESSION_KEY, historyKey: C.HISTORY_KEY });
  await page.goto('/');
  await expect(page.locator('#challenge-notice')).toContainText('corrupt');
  await expect(cells(page)).toHaveCount(81);
  await importCode(page);
  await cell(page, 4).click();
  await expect(page.locator('#smiley')).toHaveClass(/dead/);
  await page.getByRole('button', { name: 'Replay finished challenge', exact: true }).click();
  await page.getByRole('button', { name: 'Step forward', exact: true }).click();
  await expect(page.locator('#smiley')).toHaveClass(/dead/);
  expect(errors).toEqual([]);
});

for (const failure of ['getter', 'getItem', 'setItem', 'removeItem']) {
  test('storage ' + failure + ' failure keeps challenge gameplay and replay usable', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(failure => {
      if (failure === 'getter') Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } });
      else Storage.prototype[failure] = function () { throw new Error('unavailable'); };
    }, failure);
    await page.goto('/'); await importCode(page);
    await cell(page, 0).click({ button: 'right' });
    await cell(page, 4).click();
    await expect(page.locator('#smiley')).toHaveClass(/dead/);
    await page.getByRole('button', { name: 'Replay finished challenge', exact: true }).click();
    await page.getByRole('button', { name: 'Step forward', exact: true }).click();
    await page.getByRole('button', { name: 'Exit replay', exact: true }).click();
    await menu(page, 'beginner');
    await expect(page.locator('#challenge-notice')).toContainText('storage is unavailable');
    await cell(page, 0).click();
    await expect(cell(page, 0)).toHaveClass(/revealed/);
    expect(errors).toEqual([]);
  });
}

test('file:// challenge sharing, resume and expert overflow work on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 620 });
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
  await importCode(page, C.code(C.daily('2026-01-01', 'expert')));
  await expect(cells(page)).toHaveCount(480);
  const scroller = page.locator('.board-scroll');
  expect(await scroller.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await cell(page, 479).click({ button: 'right' });
  await expect(cell(page, 479)).toHaveClass(/flagged/);
  expect(await scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await menu(page, 'share');
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(page.locator('#copy-status')).toContainText('press Ctrl+C');
  await page.locator('[data-close="dialog-share"]').click();
  await page.reload();
  await expect(cell(page, 479)).toHaveClass(/flagged/);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.locator('[data-action="help"]').click();
  await expect(page.locator('#dialog-help')).toBeVisible();
  await page.locator('#help-ok').click();
});
