// Интерфейс: рисует бумагу, ловит тапы по линиям сгиба, анимирует сгиб.
// Вся логика игры — в game.js и ниже, здесь только DOM.
//
// Для отладки:
//   ?date=2026-11-08 — уровень другого дня;
//   ?moves=2s,1e     — сразу сделать сгибы без анимации;
//   ?demo=2s,1e      — показать сгибы с анимацией.
// «2s» — линия после 2-й клетки, левая часть (start) направо;
// «1e» — линия после 1-й клетки, правая часть (end) налево.

import { dailyLevel } from './daily.js';
import { createGame, currentEntry, foldsLeft, foldsUsed, gameStatus, playFold, restart, undo } from './game.js';
import { bottomColors, topLetters, visibleColors } from './level.js';
import { WORDS } from './words.js';

const $ = (id) => document.getElementById(id);
const ui = {
  meta: $('meta'),
  target: $('target'),
  table: $('table'),
  board: $('board'),
  arrows: $('arrows'),
  folds: $('folds'),
  status: $('status'),
  undo: $('undo'),
  reset: $('reset'),
};

const params = new URLSearchParams(location.search);
const date = parseDate(params.get('date')) ?? new Date();
const level = dailyLevel(date, WORDS);

let game = createGame(level);
let selected = null; // выбранная линия сгиба (номер) или null
let animating = false;

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

function el(tag, className, props = {}) {
  const node = document.createElement(tag);
  node.className = className;
  return Object.assign(node, props);
}

function plural(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'сгиб';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'сгиба';
  return 'сгибов';
}

// Размер клетки: развёрнутая полоска целиком помещается в ширину экрана.
function cellSize() {
  return Math.max(22, Math.min(52, Math.floor((ui.table.clientWidth - 16) / level.w)));
}

// Сдвиг стола, при котором текущий лист стоит по центру.
function boardShift({ state, origin }, cell) {
  return (ui.table.clientWidth - state.w * cell) / 2 - origin.x * cell;
}

// ---------- отрисовка ----------

function render({ instant = false } = {}) {
  const cell = cellSize();
  ui.table.style.setProperty('--cell', `${cell}px`);
  ui.table.style.setProperty('--hit', `${Math.min(cell, 40)}px`);

  const entry = currentEntry(game);
  const { state, origin } = entry;
  const status = gameStatus(game);
  const shift = boardShift(entry, cell);

  ui.board.classList.toggle('instant', instant);
  ui.board.style.transform = `translateX(${shift}px)`;

  const tops = visibleColors(state, level);
  const bottoms = bottomColors(state, level);
  const letters = topLetters(state, level);
  const nodes = [];

  for (let x = 0; x < state.w; x++) {
    const left = `${(origin.x + x) * cell}px`;

    const paper = el('div', `cell c${tops[x]}`);
    paper.style.left = left;
    paper.dataset.x = x;
    paper.dataset.layers = Math.min(state.stacks[x].length, 4);
    if (status === 'solved') {
      paper.classList.add('solved');
      paper.style.setProperty('--i', x);
      const letter = el('span', 'letter', { textContent: letters[x] });
      letter.style.setProperty('--i', x);
      paper.append(letter);
    }

    const under = el('div', `under c${bottoms[x]}`);
    under.style.left = left;
    under.dataset.x = x;
    nodes.push(paper, under);
  }

  if (status === 'playing' && !animating) {
    for (let at = 1; at < state.w; at++) {
      const crease = el('button', at === selected ? 'crease selected' : 'crease', { type: 'button' });
      crease.style.left = `${(origin.x + at) * cell}px`;
      crease.setAttribute('aria-label', `Линия сгиба после ${at}-й клетки`);
      crease.addEventListener('click', () => {
        selected = selected === at ? null : at;
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

  renderArrows(shift, cell, origin, status);
  renderTarget(cell, status === 'solved');
  renderFolds();
  renderStatus(status);

  const locked = animating || status === 'solved' || foldsUsed(game) === 0;
  ui.undo.disabled = locked;
  ui.reset.disabled = locked;
}

// Две стрелки над выбранной линией: каждая стоит над той частью, которая поедет.
function renderArrows(shift, cell, origin, status) {
  if (selected === null || status !== 'playing' || animating) {
    ui.arrows.replaceChildren();
    return;
  }
  const at = selected;
  const creaseX = shift + (origin.x + at) * cell;
  const groupLeft = Math.max(0, Math.min(ui.table.clientWidth - 104, creaseX - 52));

  const toRight = el('button', 'arrow', { type: 'button', textContent: '→' });
  toRight.style.left = `${groupLeft}px`;
  toRight.setAttribute('aria-label', 'Загнуть левую часть направо');
  toRight.addEventListener('click', () => doFold({ axis: 'x', at, from: 'start' }));

  const toLeft = el('button', 'arrow', { type: 'button', textContent: '←' });
  toLeft.style.left = `${groupLeft + 58}px`;
  toLeft.setAttribute('aria-label', 'Загнуть правую часть налево');
  toLeft.addEventListener('click', () => doFold({ axis: 'x', at, from: 'end' }));

  ui.arrows.replaceChildren(toRight, toLeft);
}

function renderTarget(cell, done) {
  ui.target.style.setProperty('--sw', `${Math.min(cell, 34)}px`);
  ui.target.replaceChildren(
    ...level.target.map((color, i) => {
      const swatch = el('div', `swatch c${color}`);
      swatch.style.animationDelay = `${i * 110}ms`;
      return swatch;
    }),
  );
  ui.target.classList.toggle('done', done);
}

function renderFolds(g = game) {
  const used = foldsUsed(g);
  ui.folds.replaceChildren(
    ...Array.from({ length: level.folds }, (_, i) => el('span', i < used ? 'dot used' : 'dot')),
  );
  ui.folds.setAttribute('aria-label', `Сгибов: ${used} из ${level.folds}`);
}

function renderStatus(status, g = game) {
  if (status === 'solved') {
    ui.status.replaceChildren('Складно! Слово дня:', el('span', 'word', { textContent: level.word }));
  } else if (status === 'stuck') {
    ui.status.textContent = 'Так не сложится. Отмени сгиб или начни заново.';
  } else if (selected !== null) {
    ui.status.textContent = 'Куда загнуть? Стрелка стоит над частью, которая перевернётся.';
  } else if (foldsUsed(g) === 0) {
    ui.status.textContent = `Коснись линии между клетками. Нужно ровно ${level.folds} ${plural(level.folds)}.`;
  } else {
    const left = foldsLeft(g);
    ui.status.textContent = `Осталось ${left} ${plural(left)}.`;
  }
}

// ---------- сгиб ----------

function doFold(move) {
  if (animating) return;
  const before = currentEntry(game);
  const next = playFold(game, move);
  selected = null;
  if (next === game) {
    render();
    return;
  }
  animating = true;
  ui.arrows.replaceChildren();
  ui.undo.disabled = true;
  ui.reset.disabled = true;
  renderFolds(next);
  // Победу объявляем после анимации, когда проступят буквы.
  if (gameStatus(next) !== 'solved') renderStatus(gameStatus(next), next);
  animateFold(before, move, currentEntry(next), () => {
    game = next;
    animating = false;
    render();
  });
}

// Перевёрнутая часть — отдельный «лоскут» из карточек с двумя сторонами:
// сверху то, что видно сейчас, снизу — обратная сторона. Лоскут поворачивается
// на 180° вокруг линии сгиба и ложится обратной стороной вверх — ровно как
// окажется в новом состоянии. Одновременно стол съезжает, чтобы лист был по центру.
function animateFold(before, move, after, done) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    done();
    return;
  }
  const cell = cellSize();
  const { state, origin } = before;
  const fromStart = move.from === 'start';
  const moving = [];
  for (let x = 0; x < state.w; x++) if (fromStart ? x < move.at : x >= move.at) moving.push(x);

  const tops = visibleColors(state, level);
  const bottoms = bottomColors(state, level);
  for (const node of ui.board.querySelectorAll('.cell, .under')) {
    if (moving.includes(Number(node.dataset.x))) node.classList.add('lifted');
  }
  for (const node of ui.board.querySelectorAll('.crease')) node.remove();

  const flap = el('div', 'flap');
  flap.style.left = `${(origin.x + moving[0]) * cell}px`;
  flap.style.width = `${moving.length * cell}px`;
  flap.style.transformOrigin = fromStart ? '100% 50%' : '0% 50%';
  moving.forEach((x, i) => {
    const card = el('div', 'card');
    card.style.left = `${i * cell}px`;
    card.append(el('div', `face c${tops[x]}`), el('div', `face back c${bottoms[x]}`));
    flap.append(card);
  });

  ui.board.style.perspectiveOrigin = `${(origin.x + move.at) * cell}px 50%`;
  ui.board.append(flap);
  flap.getBoundingClientRect(); // зафиксировать начальное положение, чтобы сработал переход
  ui.board.style.transform = `translateX(${boardShift(after, cell)}px)`;
  requestAnimationFrame(() => {
    flap.style.transform = `rotateY(${fromStart ? 180 : -180}deg)`;
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    flap.remove();
    done();
  };
  flap.addEventListener('transitionend', finish);
  setTimeout(finish, 900); // если transitionend не придёт
}

// ---------- события ----------

ui.undo.addEventListener('click', () => {
  if (animating) return;
  selected = null;
  game = undo(game);
  render();
});

ui.reset.addEventListener('click', () => {
  if (animating) return;
  selected = null;
  game = restart(game);
  render();
});

// Тап мимо линии — снять выбор.
ui.table.addEventListener('click', (event) => {
  if (event.target.closest('.crease, .arrow') || selected === null) return;
  selected = null;
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && selected !== null) {
    selected = null;
    render();
  }
});

window.addEventListener('resize', () => {
  if (!animating) render({ instant: true });
});

// ---------- старт ----------

ui.meta.textContent = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
for (const move of parseMoves(params.get('moves'))) game = playFold(game, move);
render({ instant: true });

const demo = parseMoves(params.get('demo'));
if (demo.length > 0) runDemo(demo);

async function runDemo(moves) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (const move of moves) {
    await wait(600);
    selected = move.at;
    render();
    await wait(500);
    doFold(move);
    await wait(1000);
  }
}
