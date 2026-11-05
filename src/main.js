// Интерфейс: бумага, сгибы пальцем и кнопками, обучение, итоги дня.
// Вся логика игры — в game.js и ниже, здесь только DOM и localStorage.
//
// Режимы:
//   tutorial — обучающий уровень из 4 клеток (сам при первом заходе);
//   daily    — уровень дня, прогресс сохраняется;
//   practice — случайные уровни, ничего не сохраняется.
//
// Для отладки:
//   ?date=2026-11-08 — уровень другого дня;
//   ?moves=2s,1e     — сразу сделать сгибы (и ничего не сохранять);
//   ?demo=2s,1e      — показать сгибы с анимацией;
//   ?tutorial        — открыть обучение.
// «2s» — линия после 2-й клетки, левая часть (start) направо; «1e» — правая (end) налево.

import { dailyLevel, dateKey, DIFFICULTY, generateWithFallback } from './daily.js';
import { fold } from './fold.js';
import {
  createGame,
  currentEntry,
  foldsLeft,
  foldsUsed,
  gameStatus,
  hintMove,
  movesOf,
  playFold,
  restart,
  undo,
} from './game.js';
import { bottomColors, topLetters, visibleColors } from './level.js';
import { currentStreak, formatDuration, parseStats, plural, recordSolve, shareText } from './progress.js';
import { mulberry32 } from './rng.js';
import { TUTORIAL_CREASE, TUTORIAL_LEVEL } from './tutorial.js';
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
const today = parseDate(params.get('date')) ?? new Date();
const todayKey = dateKey(today);
const dayStoreKey = `skladno:day:${todayKey}`;

let stats = parseStats(store.get('skladno:stats'));
let mode = 'daily';
let level = null;
let game = null;
let selected = null; // выбранная линия сгиба или null
let hint = null; // подсказанный сгиб или null
let message = null; // разовое сообщение внизу
let animating = false;
let hintsUsed = 0;
let startedAt = null;
let drag = null;
let suppressClickUntil = 0;
let countdownTimer = null;

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

function button(label, onClick, className = '') {
  const node = el('button', `btn ${className}`.trim(), { type: 'button', textContent: label });
  node.addEventListener('click', onClick);
  return node;
}

const foldsWord = (n) => plural(n, ['сгиб', 'сгиба', 'сгибов']);
const isMoving = (x, move) => (move.from === 'start' ? x < move.at : x >= move.at);
const longDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(today);
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(today);

// Размер клетки: развёрнутая полоска целиком помещается в ширину экрана.
function cellSize() {
  return Math.max(22, Math.min(52, Math.floor((ui.table.clientWidth - 16) / level.w)));
}

// Сдвиг стола, при котором лист стоит по центру.
function boardShift({ state, origin }, cell) {
  return (ui.table.clientWidth - state.w * cell) / 2 - origin.x * cell;
}

// ---------- режимы ----------

function resetRound() {
  selected = null;
  hint = null;
  message = null;
  animating = false;
  drag = null;
  hintsUsed = 0;
  startedAt = null;
  if (ui.sheet.open) ui.sheet.close();
}

function startDaily() {
  resetRound();
  mode = 'daily';
  level = dailyLevel(today, WORDS);
  game = createGame(level);

  const saved = debugMoves ? null : store.get(dayStoreKey);
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
    startedAt = Number.isFinite(saved.startedAt) ? saved.startedAt : null;
  }
  render({ instant: true });
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
}

function startTutorial() {
  resetRound();
  mode = 'tutorial';
  level = TUTORIAL_LEVEL;
  game = createGame(level);
  render({ instant: true });
}

function saveDaily(extra = {}) {
  if (mode !== 'daily' || debugMoves) return;
  const previous = store.get(dayStoreKey) ?? {};
  store.set(dayStoreKey, { ...previous, moves: movesOf(game), hints: hintsUsed, startedAt, ...extra });
}

// ---------- отрисовка ----------

function render({ instant = false } = {}) {
  const cell = cellSize();
  ui.table.style.setProperty('--cell', `${cell}px`);
  ui.table.style.setProperty('--hit', `${Math.min(cell, 44)}px`);
  renderTopbar();
  renderBoard(instant);
  renderChoices();
  renderTarget(cell);
  renderFolds();
  renderStatus();
  renderControls();
}

function renderTopbar() {
  const streak = currentStreak(stats, todayKey);
  ui.streak.hidden = mode === 'tutorial' || streak === 0;
  ui.streak.textContent = `🔥 ${streak}`;
  ui.help.textContent = mode === 'tutorial' ? 'Пропустить' : 'Как играть';
  ui.meta.textContent = { daily: longDate, practice: 'тренировка', tutorial: 'обучение' }[mode];
}

function renderBoard(instant = false) {
  const cell = cellSize();
  const entry = currentEntry(game);
  const { state, origin } = entry;
  const status = gameStatus(game);

  ui.board.classList.toggle('instant', instant);
  ui.board.style.transform = `translateX(${boardShift(entry, cell)}px)`;

  const tops = visibleColors(state, level);
  const bottoms = bottomColors(state, level);
  const letters = topLetters(state, level);
  const nodes = [];

  for (let x = 0; x < state.w; x++) {
    const paper = el('div', `cell c${tops[x]}`);
    paper.style.left = `${(origin.x + x) * cell}px`;
    paper.style.setProperty('--back', `var(--c${bottoms[x]})`);
    paper.dataset.x = x;
    paper.dataset.layers = Math.min(state.stacks[x].length, 4);
    if (status === 'solved') {
      paper.classList.add('solved');
      paper.style.setProperty('--i', x);
      const letter = el('span', 'letter', { textContent: letters[x] });
      letter.style.setProperty('--i', x);
      paper.append(letter);
    }
    nodes.push(paper);
  }

  if (status === 'playing' && !animating) {
    for (let at = 1; at < state.w; at++) {
      if (mode === 'tutorial' && at !== TUTORIAL_CREASE) continue;
      let className = 'crease';
      if (at === selected) className += ' selected';
      else if ((hint && hint.at === at) || mode === 'tutorial') className += ' hinted';
      const crease = el('button', className, { type: 'button' });
      crease.dataset.at = at;
      crease.style.left = `${(origin.x + at) * cell}px`;
      crease.setAttribute('aria-label', `Линия сгиба после ${at}-й клетки`);
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
  if (instant) {
    ui.board.getBoundingClientRect(); // применить сдвиг без анимации
    ui.board.classList.remove('instant');
  }
}

// Две кнопки «какую часть загнуть» с мини-превью того, что окажется сверху.
function renderChoices() {
  if (selected === null || gameStatus(game) !== 'playing' || animating || drag?.flap) {
    ui.choices.replaceChildren();
    return;
  }
  const { state } = currentEntry(game);
  const options = [
    { from: 'start', title: 'Левую часть →' },
    { from: 'end', title: '← Правую часть' },
  ];
  ui.choices.replaceChildren(
    ...options.map(({ from, title }) => {
      const move = { axis: 'x', at: selected, from };
      const node = el('button', 'choice', { type: 'button' });
      const hinted = (hint && hint.at === move.at && hint.from === from) || (mode === 'tutorial' && from === 'start');
      if (hinted) node.classList.add('hinted');

      const preview = el('span', 'preview');
      preview.append(...visibleColors(fold(state, move), level).map((c) => el('i', `c${c}`)));
      node.append(el('span', '', { textContent: title }), el('small', '', { textContent: 'загнуть — сверху будет:' }), preview);

      // Показать на бумаге, какая часть поедет.
      const mark = (on) => {
        for (const cellNode of ui.board.querySelectorAll('.cell')) {
          cellNode.classList.toggle('moving', on && isMoving(Number(cellNode.dataset.x), move));
        }
      };
      node.addEventListener('pointerenter', () => mark(true));
      node.addEventListener('pointerleave', () => mark(false));
      node.addEventListener('focus', () => mark(true));
      node.addEventListener('blur', () => mark(false));
      node.addEventListener('click', () => doFold(move));
      return node;
    }),
  );
}

function renderTarget(cell) {
  ui.target.style.setProperty('--sw', `${Math.min(cell, 34)}px`);
  ui.target.replaceChildren(
    ...level.target.map((color, i) => {
      const swatch = el('div', `swatch c${color}`);
      swatch.style.animationDelay = `${i * 110}ms`;
      return swatch;
    }),
  );
  ui.target.classList.toggle('done', gameStatus(game) === 'solved');
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
    ui.status.textContent = {
      solved: 'Левая половина перевернулась — и сверху оказалась её обратная сторона, как в образце. Так и проступает слово! Дальше всё то же самое, только сгибов больше.',
      stuck: 'Сверху не то, что в образце. Нажми «Отменить» и загни другую половину.',
      playing:
        selected === null
          ? 'Сверху — образец: две терракотовые клетки. Такой цвет только в уголках левых клеток — это их обратная сторона. Коснись мигающей линии посередине.'
          : 'Теперь загни левую половину: нажми кнопку или потяни бумагу пальцем вправо. Её обратная сторона окажется сверху.',
    }[status];
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
    ui.status.textContent = `Коснись линии между клетками или потяни бумагу от линии. Нужно ровно ${level.folds} ${foldsWord(level.folds)}.`;
  } else {
    const left = foldsLeft(g);
    ui.status.textContent = `Осталось ${left} ${foldsWord(left)}.`;
  }
}

function renderControls() {
  const status = gameStatus(game);
  const nodes = [];
  if (status === 'solved') {
    if (mode === 'tutorial') nodes.push(button('К уровню дня →', startDaily, 'primary wide'));
    else if (mode === 'daily') nodes.push(button('Итоги', openSheet, 'primary'), button('Тренировка', startPractice));
    else nodes.push(button('Ещё уровень', startPractice, 'primary'), button('К уровню дня', startDaily));
  } else {
    const undoButton = button('Отменить', undoMove, status === 'stuck' ? 'attention' : '');
    undoButton.disabled = foldsUsed(game) === 0;
    nodes.push(undoButton);
    if (mode !== 'tutorial') nodes.push(button('Подсказка', useHint));
    const resetButton = button('Заново', restartGame);
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
  const cell = cellSize();
  const { state, origin } = entry;
  const moving = [];
  for (let x = 0; x < state.w; x++) if (isMoving(x, move)) moving.push(x);

  const tops = visibleColors(state, level);
  const bottoms = bottomColors(state, level);
  for (const node of ui.board.querySelectorAll('.cell')) {
    node.classList.remove('moving');
    if (moving.includes(Number(node.dataset.x))) node.classList.add('lifted');
  }
  for (const node of ui.board.querySelectorAll('.crease')) node.remove();

  const flap = el('div', 'flap dragging');
  flap.style.left = `${(origin.x + moving[0]) * cell}px`;
  flap.style.width = `${moving.length * cell}px`;
  flap.style.transformOrigin = move.from === 'start' ? '100% 50%' : '0% 50%';
  moving.forEach((x, i) => {
    const card = el('div', 'card');
    card.style.left = `${i * cell}px`;
    const front = el('div', `face front c${tops[x]}`);
    front.style.setProperty('--back', `var(--c${bottoms[x]})`);
    card.append(front, el('div', `face back c${bottoms[x]}`));
    flap.append(card);
  });
  ui.board.style.perspectiveOrigin = `${(origin.x + move.at) * cell}px 50%`;
  ui.board.append(flap);

  const sign = move.from === 'start' ? 1 : -1;
  const control = {
    angle: 0,
    set(deg) {
      control.angle = deg;
      flap.style.transform = `rotateY(${sign * deg}deg)`;
    },
    animateTo(deg, done) {
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
      setTimeout(finish, 900); // если transitionend не придёт (угол не изменился и т. п.)
      requestAnimationFrame(() => control.set(deg));
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
  const before = currentEntry(game);
  const next = playFold(game, move);
  selected = null;
  hint = null;
  message = null;
  if (next === game) {
    flap?.remove();
    render();
    return;
  }
  startedAt ??= Date.now();
  animating = true;
  ui.choices.replaceChildren();
  renderFolds(next);
  if (gameStatus(next) !== 'solved') renderStatus(next); // о победе — после анимации
  renderControls();

  const control = flap ?? buildFlap(before, move);
  const cell = cellSize();
  requestAnimationFrame(() => {
    ui.board.style.transform = `translateX(${boardShift(currentEntry(next), cell)}px)`;
  });
  control.animateTo(180, () => {
    control.remove();
    game = next;
    animating = false;
    saveDaily();
    navigator.vibrate?.(10);
    render();
    if (gameStatus(game) === 'solved') onSolved();
  });
}

// Отмена — тот же сгиб в обратную сторону.
function undoMove() {
  if (animating || foldsUsed(game) === 0) return;
  const after = currentEntry(game);
  game = undo(game);
  selected = null;
  hint = null;
  message = null;
  saveDaily();

  const before = currentEntry(game);
  const cell = cellSize();
  animating = true;
  render({ instant: true });
  ui.board.classList.add('instant');
  ui.board.style.transform = `translateX(${boardShift(after, cell)}px)`;
  ui.board.getBoundingClientRect();
  ui.board.classList.remove('instant');

  const control = buildFlap(before, after.move);
  control.set(180);
  requestAnimationFrame(() => {
    ui.board.style.transform = `translateX(${boardShift(before, cell)}px)`;
  });
  control.animateTo(0, () => {
    control.remove();
    animating = false;
    render();
  });
}

function restartGame() {
  if (animating) return;
  game = restart(game);
  selected = null;
  hint = null;
  message = null;
  saveDaily();
  render();
}

function useHint() {
  if (animating) return;
  const move = hintMove(game);
  if (!move) {
    hint = null;
    selected = null;
    message = 'Отсюда уже не сложить — отмени сгиб или начни заново.';
    render();
    return;
  }
  if (!(hint && hint.at === move.at && hint.from === move.from)) hintsUsed++;
  startedAt ??= Date.now();
  hint = move;
  selected = move.at;
  message = 'Подсказка: подсвечены линия и часть, которую нужно загнуть.';
  saveDaily();
  render();
}

// ---------- сгиб пальцем ----------
// Тянешь от линии (или от бумаги, если линия уже выбрана) вправо — левая часть
// поворачивается вслед за пальцем; влево — правая. Отпустил дальше середины —
// сгиб доводится до конца, раньше — бумага ложится обратно.

ui.table.addEventListener('pointerdown', (event) => {
  if (animating || drag || gameStatus(game) !== 'playing') return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const crease = event.target.closest('.crease');
  const at = crease ? Number(crease.dataset.at) : selected;
  if (at === null || Number.isNaN(at)) return;
  if (mode === 'tutorial' && at !== TUTORIAL_CREASE) return;
  drag = { at, x0: event.clientX, y0: event.clientY, id: event.pointerId, from: null, flap: null };
});

window.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id || animating) return;
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
  drag.flap.set(Math.min(180, (Math.abs(dx) / (cellSize() * 2)) * 180));
});

function endDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const { flap, at, from } = drag;
  drag = null;
  if (!flap) return; // это был тап — его обработает click
  suppressClickUntil = Date.now() + 350;
  if (event.type === 'pointerup' && flap.angle >= 75) {
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
  return { folds: foldsUsed(game), hints: hintsUsed, ms: startedAt ? Date.now() - startedAt : 0 };
}

function onSolved() {
  navigator.vibrate?.([12, 60, 18]);
  if (mode === 'tutorial') {
    store.set('skladno:tutorial-done', true);
    setTimeout(() => confetti(28), 300);
    return;
  }
  if (mode === 'daily' && !debugMoves) {
    stats = recordSolve(stats, todayKey, currentResult());
    store.set('skladno:stats', stats);
    saveDaily({ solvedAt: Date.now() });
    renderTopbar();
  }
  setTimeout(() => confetti(64), 350);
  setTimeout(openSheet, level.targetW * 110 + 1000);
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
  if (mode === 'tutorial' || gameStatus(game) !== 'solved') return;
  const result = (mode === 'daily' && stats.days[todayKey]) || currentResult();
  const streak = currentStreak(stats, todayKey);

  const close = el('button', 'sheet-close', { type: 'button', textContent: '×' });
  close.setAttribute('aria-label', 'Закрыть');
  close.addEventListener('click', () => ui.sheet.close());

  const grid = el('div', 'stats');
  grid.append(
    stat(String(result.folds), foldsWord(result.folds)),
    stat(String(result.hints), plural(result.hints, ['подсказка', 'подсказки', 'подсказок'])),
    stat(result.ms ? formatDuration(result.ms) : '—', 'время'),
  );
  if (mode === 'daily') grid.append(stat(`🔥 ${streak}`, `лучшая: ${Math.max(stats.best, streak)}`));

  const nodes = [
    close,
    el('h2', '', { id: 'sheet-title', textContent: 'Складно!', tabIndex: -1, autofocus: true }),
    el('p', 'big-word', { textContent: level.word }),
    grid,
  ];

  const actions = el('div', 'sheet-actions');
  if (mode === 'daily') {
    const next = el('p', 'next');
    next.append('Новое слово через ', el('b', '', { textContent: '—' }));
    nodes.push(next);
    const shareButton = button('Поделиться', () => share(shareButton, result, streak), 'primary');
    actions.append(shareButton, button('Тренировка', startPractice));
  } else {
    actions.append(button('Ещё уровень', startPractice, 'primary'), button('К уровню дня', startDaily));
  }
  nodes.push(actions);

  ui.sheet.replaceChildren(...nodes);
  if (!ui.sheet.open) ui.sheet.showModal();
  startCountdown();
}

function startCountdown() {
  clearInterval(countdownTimer);
  const node = ui.sheet.querySelector('.next b');
  if (!node) return;
  const tick = () => {
    const now = new Date();
    if (!params.has('date') && dateKey(now) !== todayKey) {
      node.textContent = 'уже готово — обнови страницу';
      clearInterval(countdownTimer);
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
    folds: result.folds,
    hints: result.hints,
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
ui.sheet.addEventListener('click', (event) => {
  if (event.target === ui.sheet) ui.sheet.close(); // тап по затемнению
});

// ---------- события ----------

ui.help.addEventListener('click', () => {
  if (animating) return;
  if (mode === 'tutorial') {
    store.set('skladno:tutorial-done', true);
    startDaily();
  } else {
    startTutorial();
  }
});

// Тап мимо линии и кнопок — снять выбор.
document.addEventListener('click', (event) => {
  if (selected === null || animating || Date.now() < suppressClickUntil) return;
  if (event.target.closest('.crease, .choice, .btn, .chip, dialog')) return;
  selected = null;
  hint = null;
  message = null;
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

window.addEventListener('resize', () => {
  if (!animating && !drag && level) render({ instant: true });
});

// ---------- старт ----------

if (!reloading) {
  const debug = debugMoves || params.has('demo') || params.has('date');
  if (params.has('tutorial') || (!debug && !store.get('skladno:tutorial-done'))) startTutorial();
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
