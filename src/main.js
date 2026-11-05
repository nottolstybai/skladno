// Интерфейс: бумага, сгибы пальцем и кнопками, обучение, итоги дня.
// Вся логика игры — в game.js и ниже, здесь только DOM и localStorage.
//
// Режимы:
//   tutorial — три обучающих мини-уровня (сами при первом заходе);
//   daily    — уровень дня, прогресс и статистика сохраняются;
//   practice — случайные уровни, ничего не сохраняется.
//
// Для отладки (с ними ничего не сохраняется):
//   ?date=2026-11-08 — уровень другого дня;
//   ?moves=2s,1e     — сразу сделать сгибы;
//   ?demo=2s,1e      — показать сгибы с анимацией;
//   ?tutorial        — открыть обучение.
// «2s» — линия после 2-й клетки, левая часть (start) направо; «1e» — правая (end) налево.

import { dailyLevel, dateKey, DIFFICULTY, entryFor, generateWithFallback } from './daily.js';
import { fold, stateKey } from './fold.js';
import {
  createGame,
  currentEntry,
  foldsLeft,
  foldsUsed,
  gameStatus,
  hintMove,
  landedPositions,
  movesOf,
  playFold,
  undo,
} from './game.js';
import { bottomColors, topLetters, visibleColors } from './level.js';
import { collectedWords, currentStreak, formatDuration, parseStats, plural, recordSolve, shareText } from './progress.js';
import { mulberry32 } from './rng.js';
import { TUTORIAL } from './tutorial.js';
import { VERSION } from './version.js';
import { PRACTICE_WORDS, WORDS } from './words.js';

// ---------- защита от старого кэша ----------
// Если страница и скрипты из разных версий (браузер взял что-то из кэша),
// один раз перезагружаемся с новым адресом — тогда всё придёт свежим.

let reloading = false;
if (document.documentElement.dataset.version !== VERSION) {
  try {
    if (sessionStorage.getItem('skladno:reload') !== VERSION) {
      sessionStorage.setItem('skladno:reload', VERSION);
      const url = new URL(location.href);
      url.searchParams.set('r', VERSION);
      location.replace(url);
      reloading = true;
    }
  } catch {
    // без sessionStorage просто играем тем, что загрузилось
  }
}

// ---------- элементы и хранилище ----------

const $ = (id) => document.getElementById(id);
const ui = {
  streak: $('streak'),
  help: $('help'),
  meta: $('meta'),
  goalLabel: $('goal-label'),
  target: $('target'),
  table: $('table'),
  board: $('board'),
  choices: $('choices'),
  folds: $('folds'),
  status: $('status'),
  controls: $('controls'),
  sheet: $('sheet'),
};

const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // приватный режим или нет места — играем без сохранения
    }
  },
};

// ---------- состояние ----------

const params = new URLSearchParams(location.search);
const debugMoves = params.has('moves');
const readOnly = debugMoves || params.has('date'); // отладка не трогает настоящий прогресс
const today = parseDate(params.get('date')) ?? new Date();
const todayKey = dateKey(today);
const todayEntry = entryFor(today, WORDS);
const dayStoreKey = `skladno:day:${todayKey}`;

let stats = parseStats(store.get('skladno:stats'));
let mode = 'daily';
let tutorialIndex = 0;
let level = null;
let game = null;

let selected = null; // выбранная линия сгиба или null
let hint = null; // подсказанный сгиб или null
let hintStage = 0; // 1 — показана линия, 2 — и часть
let hintedKeys = new Set(); // какие подсказки уже засчитаны
let message = null; // разовое сообщение внизу
let animating = false;
let drag = null;
let suppressClickUntil = 0;
let revealShown = false;

let hintsUsed = 0;
let undos = 0;
let playMs = 0; // время игры, пока вкладка видна
let activeSince = null;

let sheetTimer = null;
let countdownTimer = null;
let lastWidth = 0;

// ---------- помощники ----------

function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : null;
}

function parseMoves(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((token) => /^([xy]?)(\d+)([se])$/.exec(token.trim()))
    .filter(Boolean)
    .map(([, axis, at, side]) => ({ axis: axis || 'x', at: Number(at), from: side === 's' ? 'start' : 'end' }));
}

const isValidMove = (m) =>
  m && (m.axis === 'x' || m.axis === 'y') && Number.isInteger(m.at) && (m.from === 'start' || m.from === 'end');

function el(tag, className = '', props = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return Object.assign(node, props);
}

function button(label, onClick, { className = '', focus = '' } = {}) {
  const node = el('button', `btn ${className}`.trim(), { type: 'button', textContent: label });
  if (focus) node.dataset.focus = focus;
  node.addEventListener('click', () => onClick());
  return node;
}

const foldsWord = (n) => plural(n, ['сгиб', 'сгиба', 'сгибов']);
const cellsWord = (n) => plural(n, ['клетки', 'клеток', 'клеток']);
const COLOR_NAMES = ['белая', 'терракотовая', 'синяя', 'зелёная', 'жёлтая', 'сливовая'];
const isMoving = (x, move) => (move.from === 'start' ? x < move.at : x >= move.at);
const tutorialStep = () => TUTORIAL[tutorialIndex];
const longDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(today);
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(today);

// Размер клетки на экране для полоски из n клеток.
function cellFor(n) {
  return Math.max(22, Math.min(52, Math.floor((ui.table.clientWidth - 16) / n)));
}

// Клетки стоят в «базовом» размере (по развёрнутой полоске), а стол
// сдвигается и масштабируется: лист по центру и крупнеет, когда укорачивается.
function boardTransform({ state, origin }) {
  const cell = cellFor(state.w);
  const scale = cell / cellFor(level.w);
  const x = (ui.table.clientWidth - state.w * cell) / 2 - origin.x * cell;
  const y = (ui.table.clientHeight - cell) / 2;
  return `translate(${x}px, ${y}px) scale(${scale})`;
}

function setBoardTransform(entry, { instant = false, duration = null } = {}) {
  ui.board.classList.toggle('instant', instant);
  ui.board.style.transitionDuration = duration ? `${duration}ms` : '';
  ui.board.style.transform = boardTransform(entry);
  if (instant) {
    ui.board.getBoundingClientRect();
    ui.board.classList.remove('instant');
  }
}

// ---------- время игры ----------

const clockShouldRun = () =>
  mode !== 'tutorial' && game && gameStatus(game) !== 'solved' && document.visibilityState === 'visible';

function clockStart() {
  if (activeSince === null && clockShouldRun()) activeSince = Date.now();
}

function clockStop() {
  if (activeSince !== null) {
    playMs += Date.now() - activeSince;
    activeSince = null;
  }
}

const elapsed = () => playMs + (activeSince === null ? 0 : Date.now() - activeSince);

// ---------- режимы ----------

function resetRound() {
  clearTimeout(sheetTimer);
  if (ui.sheet.open) ui.sheet.close();
  selected = null;
  hint = null;
  hintStage = 0;
  hintedKeys = new Set();
  message = null;
  animating = false;
  drag = null;
  revealShown = false;
  hintsUsed = 0;
  undos = 0;
  playMs = 0;
  activeSince = null;
}

function startDaily() {
  resetRound();
  mode = 'daily';
  level = dailyLevel(today, WORDS);
  game = createGame(level);

  const saved = readOnly ? null : store.get(dayStoreKey);
  const moves = debugMoves ? parseMoves(params.get('moves')) : Array.isArray(saved?.moves) ? saved.moves : [];
  for (const move of moves) {
    if (!isValidMove(move)) break;
    try {
      const next = playFold(game, move);
      if (next === game) break;
      game = next;
    } catch {
      break; // сохранение от старой версии уровня — начинаем с того, что сошлось
    }
  }
  if (saved) {
    hintsUsed = Number.isInteger(saved.hints) ? saved.hints : 0;
    undos = Number.isInteger(saved.undos) ? saved.undos : 0;
    playMs = Number.isFinite(saved.playMs) ? saved.playMs : 0;
  }
  render({ instant: true });
  clockStart();
}

function startPractice() {
  resetRound();
  mode = 'practice';
  const rand = mulberry32((Math.random() * 2 ** 32) >>> 0);
  const word = PRACTICE_WORDS[Math.floor(rand() * PRACTICE_WORDS.length)];
  const difficulty = DIFFICULTY[2 + Math.floor(rand() * 5)]; // как со вторника по субботу
  level = generateWithFallback(rand, word, [difficulty, DIFFICULTY[1]]);
  game = createGame(level);
  render({ instant: true });
  clockStart();
}

function startTutorial(index = 0) {
  resetRound();
  mode = 'tutorial';
  tutorialIndex = index;
  level = tutorialStep().level;
  game = createGame(level);
  render({ instant: true });
}

function finishTutorial() {
  store.set('skladno:tutorial-done', true);
  startDaily();
}

function saveDaily(extra = {}) {
  if (mode !== 'daily' || readOnly) return;
  const previous = store.get(dayStoreKey) ?? {};
  store.set(dayStoreKey, { ...previous, moves: movesOf(game), hints: hintsUsed, undos, playMs: elapsed(), ...extra });
}

// ---------- отрисовка ----------

function render({ instant = false, landed = null, focus = undefined } = {}) {
  const focusKey = focus !== undefined ? focus : (document.activeElement?.dataset?.focus ?? null);
  ui.table.style.setProperty('--cell', `${cellFor(level.w)}px`);
  ui.table.style.setProperty('--hit', `${Math.min(cellFor(level.w), 44)}px`);
  lastWidth = ui.table.clientWidth;
  renderTopbar();
  renderTarget();
  renderBoard({ instant, landed });
  renderChoices();
  renderFolds();
  renderStatus();
  renderControls();
  restoreFocus(focusKey);
}

// Перерисовка заменяет кнопки — возвращаем фокус на «ту же» кнопку.
function restoreFocus(key) {
  if (!key || document.activeElement?.dataset?.focus === key) return;
  const target =
    document.querySelector(`[data-focus="${key}"]`) ??
    (key.startsWith('choice') ? document.querySelector('[data-focus^="crease"]') : null) ??
    document.querySelector('.controls button:not(:disabled)');
  target?.focus({ preventScroll: true });
}

function renderTopbar() {
  const streak = currentStreak(stats, todayKey);
  ui.streak.hidden = mode === 'tutorial' || streak === 0;
  ui.streak.textContent = `🔥 ${streak}`;
  const lastTutorialSolved = mode === 'tutorial' && tutorialIndex === TUTORIAL.length - 1 && gameStatus(game) === 'solved';
  ui.help.hidden = lastTutorialSolved;
  ui.help.textContent = mode === 'tutorial' ? 'Пропустить' : 'Как играть';
  ui.meta.textContent = {
    daily: longDate,
    practice: 'тренировка',
    tutorial: `обучение · ${tutorialIndex + 1} из ${TUTORIAL.length}`,
  }[mode];
}

function renderTarget() {
  const n = level.targetW;
  const fit = Math.floor((ui.table.clientWidth - 12 - 4 * (n - 1)) / n);
  ui.target.style.setProperty('--tile', `${Math.min(cellFor(n), fit)}px`);
  ui.target.replaceChildren(
    ...level.target.map((color, i) => {
      const tile = el('div', `tile c${color}`);
      tile.style.animationDelay = `${i * 110}ms`;
      return tile;
    }),
  );
  ui.target.setAttribute('aria-label', `Образец: ${level.target.map((c) => COLOR_NAMES[c]).join(', ')}`);
  ui.target.classList.toggle('done', gameStatus(game) === 'solved');
  ui.goalLabel.replaceChildren('Сложи полоску до ', el('b', '', { textContent: `${n} ${cellsWord(n)}` }), ' — чтобы сверху было:');
}

function renderBoard({ instant = false, landed = null } = {}) {
  const base = cellFor(level.w);
  const entry = currentEntry(game);
  const { state, origin } = entry;
  const status = gameStatus(game);
  setBoardTransform(entry, { instant });

  const tops = visibleColors(state, level);
  const bottoms = bottomColors(state, level);
  const letters = topLetters(state, level);
  const landedSet = new Set(landed ?? []);
  const nodes = [];

  for (let x = 0; x < state.w; x++) {
    const paper = el('div', `cell c${tops[x]}`);
    paper.style.left = `${(origin.x + x) * base}px`;
    paper.style.setProperty('--back', `var(--c${bottoms[x]})`);
    paper.dataset.x = x;
    paper.dataset.layers = Math.min(state.stacks[x].length, 4);
    if (landedSet.has(x)) paper.classList.add('landed');
    if (status === 'solved') {
      paper.classList.add('solved');
      if (revealShown) paper.classList.add('shown');
      paper.style.setProperty('--i', x);
      const letter = el('span', 'letter', { textContent: letters[x] });
      letter.style.setProperty('--i', x);
      paper.append(letter);
    }
    nodes.push(paper);
  }
  if (status === 'solved') revealShown = true;

  if (status === 'playing' && !animating) {
    const only = mode === 'tutorial' ? tutorialStep().crease : null;
    for (let at = 1; at < state.w; at++) {
      if (only !== null && at !== only) continue;
      let className = 'crease';
      if (at === selected) className += ' selected';
      else if ((hint && hint.at === at) || only !== null) className += ' hinted';
      const crease = el('button', className, { type: 'button' });
      crease.dataset.at = at;
      crease.dataset.focus = `crease-${at}`;
      crease.style.left = `${(origin.x + at) * base}px`;
      crease.setAttribute('aria-label', `Линия сгиба после ${at}-й клетки`);
      crease.setAttribute('aria-pressed', String(at === selected));
      crease.addEventListener('click', () => {
        if (Date.now() < suppressClickUntil) return;
        selected = selected === at ? null : at;
        message = null;
        render();
      });
      nodes.push(crease);
    }
  }

  ui.board.replaceChildren(...nodes);
  const describe = tops.map((c) => COLOR_NAMES[c]).join(', ');
  ui.table.setAttribute('aria-label', `Бумага: ${state.w} ${plural(state.w, ['клетка', 'клетки', 'клеток'])} — ${describe}`);
}

// Две кнопки «какую часть загнуть» с превью результата. Место под них
// зарезервировано, так что ничего не прыгает.
function renderChoices() {
  if (selected === null || gameStatus(game) !== 'playing' || animating || drag?.flap) {
    ui.choices.replaceChildren();
    return;
  }
  const { state } = currentEntry(game);
  const hintedSide =
    mode === 'tutorial' ? tutorialStep().side : hint && hintStage === 2 && hint.at === selected ? hint.from : null;
  const options = [
    { from: 'start', title: 'Левую часть →' },
    { from: 'end', title: '← Правую часть' },
  ];
  ui.choices.replaceChildren(
    ...options.map(({ from, title }) => {
      const move = { axis: 'x', at: selected, from };
      const node = el('button', from === hintedSide ? 'choice hinted' : 'choice', { type: 'button' });
      node.dataset.focus = `choice-${from}`;

      const result = visibleColors(fold(state, move), level);
      const preview = el('span', 'preview');
      preview.append(...result.map((c) => el('i', `c${c}`)));
      node.append(el('span', '', { textContent: title }), el('small', '', { textContent: 'загнуть — сверху будет:' }), preview);
      node.setAttribute('aria-label', `${from === 'start' ? 'Загнуть левую часть' : 'Загнуть правую часть'}. Сверху будет: ${result.map((c) => COLOR_NAMES[c]).join(', ')}`);

      // Показать на бумаге, какая часть поедет: при наведении, фокусе и касании.
      const mark = (on) => {
        for (const cellNode of ui.board.querySelectorAll('.cell')) {
          cellNode.classList.toggle('moving', on && isMoving(Number(cellNode.dataset.x), move));
        }
      };
      node.addEventListener('pointerenter', () => mark(true));
      node.addEventListener('pointerdown', () => mark(true));
      node.addEventListener('pointerleave', () => mark(false));
      node.addEventListener('focus', () => mark(true));
      node.addEventListener('blur', () => mark(false));
      node.addEventListener('click', () => doFold(move));
      return node;
    }),
  );
}

function renderFolds(g = game) {
  const used = foldsUsed(g);
  ui.folds.replaceChildren(
    ...Array.from({ length: level.folds }, (_, i) => el('span', i < used ? 'dot used' : 'dot')),
  );
  ui.folds.setAttribute('aria-label', `Сгибов: ${used} из ${level.folds}`);
}

function renderStatus(g = game) {
  const status = gameStatus(g);
  ui.status.classList.toggle('coach', mode === 'tutorial');

  if (mode === 'tutorial') {
    const { text } = tutorialStep();
    ui.status.textContent = status === 'playing' ? (selected === null ? text.start : text.selected) : text[status];
    return;
  }
  if (status === 'solved') {
    ui.status.replaceChildren(mode === 'daily' ? 'Складно! Слово дня:' : 'Складно! Слово:', el('span', 'word', { textContent: level.word }));
  } else if (message) {
    ui.status.textContent = message;
  } else if (status === 'stuck') {
    ui.status.textContent = 'Так не сложится. Отмени сгиб или нажми «Подсказка».';
  } else if (selected !== null) {
    ui.status.textContent = 'Загни левую или правую часть — кнопкой или потянув бумагу.';
  } else if (foldsUsed(g) === 0) {
    ui.status.textContent = `Каждый сгиб укорачивает полоску. Нужно ровно ${level.folds} ${foldsWord(level.folds)}: коснись линии между клетками или потяни от неё.`;
  } else {
    const left = foldsLeft(g);
    ui.status.textContent = `Осталось ${left} ${foldsWord(left)}.`;
  }
}

function renderControls() {
  const status = gameStatus(game);
  const nodes = [];
  if (status === 'solved') {
    if (mode === 'tutorial') {
      const last = tutorialIndex === TUTORIAL.length - 1;
      nodes.push(
        last
          ? button('К уровню дня →', finishTutorial, { className: 'primary wide', focus: 'btn-next' })
          : button('Дальше →', () => startTutorial(tutorialIndex + 1), { className: 'primary wide', focus: 'btn-next' }),
      );
    } else if (mode === 'daily') {
      nodes.push(
        button('Итоги', openSheet, { className: 'primary', focus: 'btn-sheet' }),
        button('Тренировка', startPractice, { focus: 'btn-practice' }),
      );
    } else {
      nodes.push(
        button('Ещё уровень', startPractice, { className: 'primary', focus: 'btn-practice' }),
        button('К уровню дня', startDaily, { focus: 'btn-daily' }),
      );
    }
  } else {
    const undoButton = button('Отменить', () => undoMove(), {
      className: status === 'stuck' ? 'attention' : '',
      focus: 'btn-undo',
    });
    undoButton.disabled = foldsUsed(game) === 0;
    nodes.push(undoButton);
    if (mode !== 'tutorial' || tutorialStep().crease === null) nodes.push(button('Подсказка', useHint, { focus: 'btn-hint' }));
    const resetButton = button('Заново', restartGame, { focus: 'btn-reset' });
    resetButton.disabled = foldsUsed(game) === 0;
    nodes.push(resetButton);
  }
  if (animating) for (const node of nodes) node.disabled = true;
  ui.controls.replaceChildren(...nodes);
}

// ---------- лоскут: перевёрнутая часть бумаги ----------
// Карточки с двумя сторонами: сверху то, что видно сейчас, снизу — обратная
// сторона. Поворот на 180° вокруг линии сгиба кладёт их обратной стороной
// вверх — ровно как окажется в новом состоянии.

function buildFlap(entry, move) {
  const base = cellFor(level.w);
  const { state, origin } = entry;
  const moving = [];
  for (let x = 0; x < state.w; x++) if (isMoving(x, move)) moving.push(x);

  const tops = visibleColors(state, level);
  const bottoms = bottomColors(state, level);
  for (const node of ui.board.querySelectorAll('.cell')) {
    node.classList.remove('moving', 'landed');
    if (moving.includes(Number(node.dataset.x))) node.classList.add('lifted');
  }
  for (const node of ui.board.querySelectorAll('.crease')) node.remove();

  const flap = el('div', 'flap dragging');
  flap.style.left = `${(origin.x + moving[0]) * base}px`;
  flap.style.width = `${moving.length * base}px`;
  flap.style.transformOrigin = move.from === 'start' ? '100% 50%' : '0% 50%';
  moving.forEach((x, i) => {
    const card = el('div', 'card');
    card.style.left = `${i * base}px`;
    const front = el('div', `face front c${tops[x]}`);
    front.style.setProperty('--back', `var(--c${bottoms[x]})`);
    card.append(front, el('div', `face back c${bottoms[x]}`));
    flap.append(card);
  });
  ui.board.style.perspectiveOrigin = `${(origin.x + move.at) * base}px 50%`;
  ui.board.append(flap);

  const sign = move.from === 'start' ? 1 : -1;
  const control = {
    angle: 0,
    set(deg) {
      control.angle = deg;
      flap.style.transform = `rotateY(${sign * deg}deg)`;
      if (flap.classList.contains('dragging')) {
        flap.style.setProperty('--shade', (Math.sin((deg * Math.PI) / 180) * 0.32).toFixed(3));
      }
    },
    // Доводка: длительность пропорциональна оставшемуся углу.
    animateTo(deg, done, duration = null) {
      const from = control.angle;
      const ms = duration ?? Math.max(220, Math.round((620 * Math.abs(deg - from)) / 180));
      flap.style.transitionDuration = `${ms}ms`;
      flap.style.setProperty('--dur', `${ms}ms`);
      flap.style.setProperty('--shade', '0');
      flap.classList.toggle('folding', Math.abs(deg - from) === 180);
      flap.getBoundingClientRect(); // зафиксировать текущий угол
      flap.classList.remove('dragging');
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        done();
      };
      flap.addEventListener('transitionend', (event) => {
        if (event.target === flap) finish();
      });
      setTimeout(finish, ms + 300); // если transitionend не придёт
      requestAnimationFrame(() => control.set(deg));
      return ms;
    },
    remove() {
      flap.remove();
    },
  };
  return control;
}

// ---------- действия ----------

function doFold(move, flap = null) {
  if (animating) return;
  const focusKey = document.activeElement?.dataset?.focus ?? null;
  const before = currentEntry(game);
  const next = playFold(game, move);
  selected = null;
  hint = null;
  hintStage = 0;
  message = null;
  if (next === game) {
    flap?.remove();
    render();
    return;
  }
  animating = true;
  ui.choices.replaceChildren();
  renderFolds(next);
  if (gameStatus(next) !== 'solved') renderStatus(next); // о победе — после анимации
  renderControls();

  const control = flap ?? buildFlap(before, move);
  const ms = control.animateTo(180, () => {
    control.remove();
    game = next;
    animating = false;
    saveDaily();
    navigator.vibrate?.(10);
    render({ landed: landedPositions(before.state, move), focus: focusKey });
    if (gameStatus(game) === 'solved') onSolved();
  });
  requestAnimationFrame(() => setBoardTransform(currentEntry(next), { duration: ms }));
}

// Отмена — тот же сгиб в обратную сторону.
function undoMove({ fast = false, counted = true } = {}) {
  return new Promise((resolve) => {
    if (animating || foldsUsed(game) === 0) {
      resolve();
      return;
    }
    if (counted) undos++;
    const after = currentEntry(game);
    game = undo(game);
    selected = null;
    hint = null;
    hintStage = 0;
    message = null;
    saveDaily();

    const before = currentEntry(game);
    animating = true;
    render({ instant: true });
    setBoardTransform(after, { instant: true });

    const control = buildFlap(before, after.move);
    control.set(180);
    const ms = control.animateTo(
      0,
      () => {
        control.remove();
        animating = false;
        render();
        resolve();
      },
      fast ? 260 : null,
    );
    requestAnimationFrame(() => setBoardTransform(before, { duration: ms }));
  });
}

// «Заново» — быстро разворачиваем все сгибы по очереди.
async function restartGame() {
  if (animating || foldsUsed(game) === 0) return;
  undos++;
  while (foldsUsed(game) > 0) await undoMove({ fast: true, counted: false });
  saveDaily();
}

// Подсказка по ступеням: сначала только линия, второе нажатие — и часть.
function useHint() {
  if (animating) return;
  const move = hintMove(game);
  if (!move) {
    hint = null;
    hintStage = 0;
    selected = null;
    message = 'Отсюда уже не сложить — отмени сгиб или начни заново.';
    render();
    return;
  }
  const same = hint && hint.at === move.at && hint.from === move.from;
  hintStage = same ? 2 : 1;
  hint = move;
  const key = `${stateKey(currentEntry(game).state)}|${move.at}${move.from}|${hintStage}`;
  if (!hintedKeys.has(key)) {
    hintedKeys.add(key);
    hintsUsed++;
  }
  if (hintStage === 1) {
    selected = null;
    message = 'Подсказка: сгибай по мигающей линии. Нажми «Подсказка» ещё раз — покажу, какую часть.';
  } else {
    selected = move.at;
    message = 'Подсказка: загни подсвеченную часть.';
  }
  saveDaily();
  render();
}

// ---------- сгиб пальцем ----------
// Тянешь от линии (или от бумаги, если линия уже выбрана) вправо — левая часть
// поворачивается вслед за пальцем; влево — правая. Отпустил после 80° или
// быстрым движением в ту же сторону — сгиб доводится, иначе бумага ложится обратно.

ui.table.addEventListener('pointerdown', (event) => {
  if (animating || drag || gameStatus(game) !== 'playing') return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const crease = event.target.closest('.crease');
  const at = crease ? Number(crease.dataset.at) : selected;
  if (at === null || Number.isNaN(at)) return;
  if (mode === 'tutorial' && tutorialStep().crease !== null && at !== tutorialStep().crease) return;
  const now = performance.now();
  drag = { at, x0: event.clientX, y0: event.clientY, id: event.pointerId, from: null, flap: null, lastX: event.clientX, lastT: now, vx: 0 };
});

window.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id || animating) return;
  const now = performance.now();
  const dt = now - drag.lastT;
  if (dt > 0) drag.vx = 0.6 * drag.vx + 0.4 * ((event.clientX - drag.lastX) / dt);
  drag.lastX = event.clientX;
  drag.lastT = now;

  const dx = event.clientX - drag.x0;
  const dy = event.clientY - drag.y0;
  if (!drag.flap) {
    if (Math.abs(dx) < 10) return;
    if (Math.abs(dy) > Math.abs(dx)) {
      drag = null; // вертикальный жест — это прокрутка, не сгиб
      return;
    }
  }
  const from = dx >= 0 ? 'start' : 'end';
  if (from !== drag.from) {
    if (drag.flap) {
      drag.flap.remove();
      renderBoard();
    }
    drag.from = from;
    selected = drag.at;
    drag.flap = buildFlap(currentEntry(game), { axis: 'x', at: drag.at, from });
    ui.choices.replaceChildren();
  }
  drag.flap.set(Math.min(180, (Math.abs(dx) / (cellFor(currentEntry(game).state.w) * 2)) * 180));
});

function endDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const { flap, at, from, vx } = drag;
  drag = null;
  if (!flap) return; // это был тап — его обработает click
  suppressClickUntil = Date.now() + 350;
  const fling = vx * (from === 'start' ? 1 : -1); // скорость в сторону сгиба, px/мс
  const complete = event.type === 'pointerup' && fling > -0.4 && (flap.angle >= 80 || (fling > 0.5 && flap.angle >= 15));
  if (complete) {
    doFold({ axis: 'x', at, from }, flap);
    return;
  }
  animating = true;
  flap.animateTo(0, () => {
    flap.remove();
    animating = false;
    render();
  });
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// ---------- победа ----------

function currentResult() {
  return { word: level.word, folds: level.folds, hints: hintsUsed, undos, ms: elapsed() };
}

function onSolved() {
  clockStop();
  navigator.vibrate?.([12, 60, 18]);
  if (mode === 'tutorial') {
    if (tutorialIndex === TUTORIAL.length - 1) store.set('skladno:tutorial-done', true);
    setTimeout(() => confetti(28), 300);
    return;
  }
  if (mode === 'daily' && !readOnly) {
    stats = recordSolve(stats, todayKey, currentResult());
    store.set('skladno:stats', stats);
    saveDaily({ solvedAt: Date.now() });
    renderTopbar();
  }
  setTimeout(() => confetti(64), 350);
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(openSheet, level.targetW * 110 + 1100);
}

function confetti(count) {
  const layer = el('div', 'confetti');
  for (let i = 0; i < count; i++) {
    const piece = el('i', `c${1 + (i % 5)}`);
    piece.style.setProperty('--x', `${Math.random() * 100}%`);
    piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    piece.style.setProperty('--r', `${Math.random() * 900 - 450}deg`);
    piece.style.setProperty('--d', `${Math.random() * 500}ms`);
    piece.style.setProperty('--t', `${1800 + Math.random() * 1600}ms`);
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 4500);
}

function stat(value, label) {
  const node = el('div', 'stat');
  node.append(el('b', '', { textContent: value }), el('span', '', { textContent: label }));
  return node;
}

function openSheet() {
  clearTimeout(sheetTimer);
  if (ui.sheet.open || mode === 'tutorial' || gameStatus(game) !== 'solved') return;
  const result = (mode === 'daily' && !readOnly && stats.days[todayKey]) || currentResult();
  const streak = currentStreak(stats, todayKey);
  const hints = result.hints ?? 0;
  const undoCount = result.undos ?? 0;

  const close = el('button', 'sheet-close', { type: 'button', textContent: '×' });
  close.setAttribute('aria-label', 'Закрыть');
  close.addEventListener('click', () => ui.sheet.close());

  const nodes = [
    close,
    el('h2', '', { id: 'sheet-title', textContent: 'Складно!', tabIndex: -1, autofocus: true }),
    el('p', 'big-word', { textContent: level.word }),
  ];
  if (mode === 'daily' && todayEntry.note) nodes.push(el('p', 'note', { textContent: todayEntry.note }));

  const grid = el('div', 'stats');
  grid.append(
    stat(result.ms ? formatDuration(result.ms) : '—', 'время'),
    stat(String(hints), plural(hints, ['подсказка', 'подсказки', 'подсказок'])),
    stat(String(undoCount), plural(undoCount, ['отмена', 'отмены', 'отмен'])),
  );
  if (mode === 'daily') grid.append(stat(`🔥 ${streak}`, `лучшая: ${Math.max(stats.best, streak)}`));
  nodes.push(grid);

  const actions = el('div', 'sheet-actions');
  if (mode === 'daily') {
    const words = collectedWords(stats);
    if (words.length > 0) {
      const collection = el('section', 'collection');
      const list = el('div', 'words');
      list.append(...words.slice(-40).map(({ date, word }) => el('span', date === todayKey ? 'today' : '', { textContent: word })));
      collection.append(el('h3', '', { textContent: `Собранные слова · ${words.length}` }), list);
      nodes.push(collection);
    }
    const next = el('p', 'next');
    next.append('Новое слово через ', el('b', '', { textContent: '—' }));
    nodes.push(next);
    const shareButton = button('Поделиться', () => share(shareButton, { ...result, hints, undos: undoCount }, streak), {
      className: 'primary',
    });
    actions.append(shareButton, button('Тренировка', startPractice));
  } else {
    actions.append(button('Ещё уровень', startPractice, { className: 'primary' }), button('К уровню дня', startDaily));
  }
  nodes.push(actions);

  ui.sheet.replaceChildren(...nodes);
  ui.sheet.showModal();
  startCountdown();
}

function startCountdown() {
  clearInterval(countdownTimer);
  const node = ui.sheet.querySelector('.next b');
  if (!node) return;
  const tick = () => {
    const now = new Date();
    if (!params.has('date') && dateKey(now) !== todayKey) {
      node.textContent = 'уже готово';
      clearInterval(countdownTimer);
      checkNewDay();
      return;
    }
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    node.textContent = formatDuration(midnight - now);
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

async function share(node, result, streak) {
  const text = shareText({
    dateLabel: shortDate,
    target: level.target,
    folds: level.folds,
    hints: result.hints,
    undos: result.undos,
    streak,
    url: location.origin + location.pathname,
  });
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    node.textContent = 'Скопировано ✓';
  } catch (error) {
    if (error?.name !== 'AbortError') node.textContent = 'Не вышло скопировать';
  }
}

ui.sheet.addEventListener('close', () => clearInterval(countdownTimer));
// Закрыть по тапу на затемнение — но не по тапу внутри окна.
ui.sheet.addEventListener('click', (event) => {
  if (event.target !== ui.sheet) return;
  const r = ui.sheet.getBoundingClientRect();
  const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
  if (!inside) ui.sheet.close();
});

// ---------- новый день ----------
// Мобильные браузеры поднимают вкладку из памяти без перезагрузки —
// сверяем дату при возврате и раз в полминуты.

function checkNewDay() {
  if (params.has('date') || animating || drag) return;
  if (dateKey(new Date()) !== todayKey) {
    saveDaily();
    location.reload();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    clockStop();
    saveDaily();
  } else {
    checkNewDay();
    clockStart();
  }
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) checkNewDay();
});
setInterval(checkNewDay, 30_000);

// ---------- события ----------

ui.help.addEventListener('click', () => {
  if (animating) return;
  if (mode === 'tutorial') finishTutorial();
  else startTutorial(0);
});

// Тап мимо линии и кнопок — снять выбор (подсказка остаётся).
document.addEventListener('click', (event) => {
  if (selected === null || animating || Date.now() < suppressClickUntil) return;
  if (event.target.closest('.crease, .choice, .btn, .chip, dialog')) return;
  selected = null;
  render();
});

document.addEventListener('keydown', (event) => {
  if (ui.sheet.open || animating) return;
  if (event.key === 'Escape' && selected !== null) {
    selected = null;
    render();
  } else if (selected !== null && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
    event.preventDefault();
    doFold({ axis: 'x', at: selected, from: event.key === 'ArrowRight' ? 'start' : 'end' });
  } else if (event.code === 'KeyZ' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    undoMove();
  }
});

// Перерисовываем только при смене ширины: на iOS resize приходит и от адресной строки.
window.addEventListener('resize', () => {
  if (!level || animating || drag || ui.table.clientWidth === lastWidth) return;
  render({ instant: true });
});

// ---------- старт ----------

if (!reloading) {
  const debug = readOnly || params.has('demo');
  if (params.has('tutorial') || (!debug && !store.get('skladno:tutorial-done'))) startTutorial(0);
  else startDaily();

  const demo = parseMoves(params.get('demo'));
  if (demo.length > 0) runDemo(demo);
}

async function runDemo(moves) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (const move of moves) {
    await wait(600);
    selected = move.at;
    render();
    await wait(500);
    doFold(move);
    await wait(1200);
  }
}
