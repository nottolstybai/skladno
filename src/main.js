// Интерфейс: лист бумаги в 3D, сгиб пальцем, переворот, подсказки, финал,
// альбом и архив. Вся логика игры — в game.js и ниже, здесь только DOM,
// анимация и localStorage.
//
// Режимы:
//   tutorial — четыре обучающих мини-уровня (сами при первом заходе);
//   daily    — уровень дня (или прошедшего дня из альбома), прогресс сохраняется;
//   practice — случайные уровни, ничего не сохраняется.
//
// Для отладки (с ними ничего не сохраняется):
//   ?date=2026-11-08     — уровень другого дня;
//   ?play=solution       — сразу решить; ?play=x2s,y1e,f — сразу сделать действия;
//   ?demo=solution       — показать действия с анимацией;
//   ?tutorial            — открыть обучение.
// Действие: x2s — вертикальная линия после 2-го столбца, левая часть (start) направо;
// y1e — горизонтальная после 1-й строки, нижняя часть (end) вверх; f — перевернуть лист.

import { dailyLevel, dateKey, DIFFICULTY, buildLevel, entryFor, parseDateKey } from './daily.js';
import { faceId, flipSheet, fold } from './fold.js';
import {
  actionsOf,
  createGame,
  currentEntry,
  foldsLeft,
  foldsUsed,
  gameStatus,
  hintAction,
  originAfterFold,
  play,
  playFlip,
  playFold,
  replay,
  undo,
} from './game.js';
import { drawPicture, pictureTitle, pictureUrl } from './picture.js';
import {
  addDays,
  collectedDays,
  currentStreak,
  formatDuration,
  parseStats,
  plural,
  recordSolve,
  shareText,
} from './progress.js';
import { mulberry32 } from './rng.js';
import { TUTORIAL } from './tutorial.js';
import { VERSION } from './version.js';
import { WORDS } from './words.js';

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
  album: $('album'),
  sound: $('sound'),
  help: $('help'),
  target: $('target'),
  goal: $('goal-text'),
  table: $('table'),
  board: $('board'),
  folds: $('folds'),
  status: $('status'),
  choices: $('choices'),
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
const debugDate = parseDateKey(params.get('date'));
const readOnly = params.has('play') || params.has('demo') || debugDate !== null;
const realToday = () => dateKey(new Date());
const todayKey = debugDate ? dateKey(debugDate) : realToday();
const FIRST_DAY = '2026-11-01';
const TUTORIAL_KEY = 'skladno:tutorial-v2';

let stats = parseStats(store.get('skladno:stats'));
let soundOn = store.get('skladno:sound') !== false;

let mode = 'daily';
let dayKey = todayKey; // какой день играем в режиме daily
let tutorialIndex = 0;
let level = null;
let game = null;
let picture = null; // { svg, url, scene, sky }

let selected = null; // выбранная линия { axis, at } или null
let hint = null; // подсказанное действие или null
let hintedKeys = new Set();
let animating = false;
let drag = null;
let suppressClickUntil = 0;
let finaleShown = false;

let hintsUsed = 0;
let undos = 0;
let playMs = 0;
let activeSince = null;

let sheetTimer = null;
let countdownTimer = null;
let lastWidth = 0;
let view = null; // { base, cell, scale, tx, ty } — как лист сейчас лежит на столе

// ---------- помощники ----------

function el(tag, className = '', props = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return Object.assign(node, props);
}

function button(label, onClick, { className = '', focus = '', icon = '' } = {}) {
  const node = el('button', `btn ${className}`.trim(), { type: 'button' });
  if (icon) node.append(el('span', 'icon', { textContent: icon, ariaHidden: 'true' }));
  node.append(label);
  if (focus) node.dataset.focus = focus;
  node.addEventListener('click', () => onClick());
  return node;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const foldsWord = (n) => plural(n, ['сгиб', 'сгиба', 'сгибов']);
const tutorialStep = () => TUTORIAL[tutorialIndex];
const isPast = () => mode === 'daily' && dayKey !== todayKey;
const dayDate = (key) => parseDateKey(key);
const dateFormat = (options) => new Intl.DateTimeFormat('ru-RU', options);
const longDate = (key) => dateFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(dayDate(key));
const shortDate = (key) => dateFormat({ day: 'numeric', month: 'long' }).format(dayDate(key));
const dayStoreKey = (key) => `skladno:day:${key}`;
const sameAction = (a, b) => !!a && !!b && (a.flip ? !!b.flip : !b.flip && a.axis === b.axis && a.at === b.at && a.from === b.from);

function parseActions(value) {
  if (!value) return [];
  if (value === 'solution') return level.solution;
  return value
    .split(',')
    .map((token) => token.trim())
    .map((token) => {
      if (token === 'f') return { flip: true };
      const match = /^([xy])(\d+)([se])$/.exec(token);
      return match ? { axis: match[1], at: Number(match[2]), from: match[3] === 's' ? 'start' : 'end' } : null;
    })
    .filter(Boolean);
}

const isValidAction = (a) =>
  a &&
  (a.flip === true ||
    ((a.axis === 'x' || a.axis === 'y') && Number.isInteger(a.at) && (a.from === 'start' || a.from === 'end')));

// ---------- звук ----------
// Бумага звучит как россыпь мелких щелчков разной силы (хруст) поверх тихого шороха.
// Такой «хруст» синтезируется один раз и дальше проигрывается через фильтры:
// пока тянешь — громкость по скорости бумаги, при приземлении — короткий «хрусть»
// по линии сгиба и мягкий шлепок бумаги о бумагу. Без файлов.

let audio = null;
let crackle = null;

function audioContext() {
  if (!soundOn) return null;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    return audio;
  } catch {
    return null;
  }
}

function crackleBuffer(ac) {
  if (crackle) return crackle;
  const sr = ac.sampleRate;
  const length = Math.floor(sr * 2);
  const buffer = ac.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);
  // тихий шорох с «гуляющей» громкостью
  let hiss = 0;
  for (let i = 0; i < length; i++) {
    if (i % 300 === 0) hiss = 0.02 + Math.random() * 0.05;
    data[i] = (Math.random() * 2 - 1) * hiss;
  }
  // хруст: короткие щелчки сгустками — то часто, то реже; в основном тихие, изредка громкие
  for (let i = 0; i < length; ) {
    const dense = Math.random() < 0.25;
    i += 1 + Math.floor((-Math.log(1 - Math.random()) * sr) / (dense ? 3000 : 600));
    const amp = Math.random() ** 3;
    const decay = 6 + Math.random() * 50; // 0,1–1 мс
    for (let k = 0; k < decay * 5 && i + k < length; k++) {
      data[i + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / decay);
    }
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
  for (let i = 0; i < length; i++) data[i] /= peak * 1.1;
  crackle = buffer;
  return buffer;
}

// Голос бумаги: хруст по кругу через полосу частот; громкостью управляет вызывающий.
function paperVoice(ac, { rate = 1, low = 900, high = 9000 } = {}) {
  const src = ac.createBufferSource();
  src.buffer = crackleBuffer(ac);
  src.loop = true;
  src.playbackRate.value = rate * (0.9 + Math.random() * 0.2);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = low;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = high;
  const gain = ac.createGain();
  gain.gain.value = 0;
  src.connect(hp);
  hp.connect(lp);
  lp.connect(gain);
  gain.connect(ac.destination);
  src.start(ac.currentTime, Math.random() * 1.8);
  return { gain: gain.gain, stop: (at) => src.stop(at) };
}

// Мягкий шлепок: короткий шум через низкие частоты.
function thud(ac, at, { level = 0.3, freq = 260, length = 0.09 } = {}) {
  const n = Math.floor(ac.sampleRate * length);
  const buffer = ac.createBuffer(1, n, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let k = 0; k < n; k++) data[k] = (Math.random() * 2 - 1) * Math.exp(-k / (n / 5));
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq;
  const gain = ac.createGain();
  gain.gain.value = level;
  src.connect(lp);
  lp.connect(gain);
  gain.connect(ac.destination);
  src.start(at);
}

// Разовый звук: 'move' — шорох на всё движение, 'land' — бумага легла, 'stamp' — печать.
function sound(kind, { duration = 0.3, flip = false } = {}) {
  const ac = audioContext();
  if (!ac) return;
  try {
    const now = ac.currentTime;
    if (kind === 'stamp') {
      thud(ac, now, { level: 0.9, freq: 170, length: 0.14 });
      const voice = paperVoice(ac, { rate: 0.8, low: 1500 });
      voice.gain.setValueAtTime(0.45, now);
      voice.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      voice.stop(now + 0.1);
      return;
    }
    if (kind === 'land') {
      const voice = paperVoice(ac, { rate: 1.25, low: 1800 });
      voice.gain.setValueAtTime(0.85, now);
      voice.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      voice.stop(now + 0.12);
      thud(ac, now + 0.004, { level: 0.32 });
      return;
    }
    const voice = paperVoice(ac, { rate: flip ? 0.85 : 1, low: flip ? 500 : 900 });
    const level = flip ? 0.38 : 0.3;
    const end = now + Math.max(0.15, duration);
    voice.gain.setValueAtTime(0.0001, now);
    voice.gain.exponentialRampToValueAtTime(level, now + 0.05);
    voice.gain.setValueAtTime(level, Math.max(now + 0.06, end - 0.12));
    voice.gain.exponentialRampToValueAtTime(0.0001, end);
    voice.stop(end + 0.05);
    if (flip) thud(ac, end - 0.04, { level: 0.22, freq: 200 });
  } catch {
    // без звука
  }
}

// Шорох, пока тянешь лист: громкость следует за скоростью бумаги.
function dragVoice() {
  const ac = audioContext();
  if (!ac) return null;
  try {
    const voice = paperVoice(ac);
    return {
      speed(perMs) {
        voice.gain.setTargetAtTime(Math.min(0.42, perMs * 0.9), ac.currentTime, 0.03);
      },
      stop() {
        voice.gain.setTargetAtTime(0, ac.currentTime, 0.04);
        voice.stop(ac.currentTime + 0.3);
      },
    };
  } catch {
    return null;
  }
}

// ---------- геометрия стола ----------
// Клетки стоят в «базовом» размере (по развёрнутому листу), а доска сдвигается
// и масштабируется: лист по центру стола и крупнеет, когда становится меньше.

function cellFor(w, h) {
  const W = ui.table.clientWidth - 28;
  const H = ui.table.clientHeight - 28;
  return Math.max(16, Math.floor(Math.min(W / w, H / h, 104)));
}

function computeView({ state, origin }) {
  const base = cellFor(level.w, level.h);
  const cell = cellFor(state.w, state.h);
  const scale = cell / base;
  const tx = (ui.table.clientWidth - state.w * cell) / 2 - origin.x * cell;
  const ty = (ui.table.clientHeight - state.h * cell) / 2 - origin.y * cell;
  return { base, cell, scale, tx, ty };
}

function applyView(entry, { instant = false } = {}) {
  view = computeView(entry);
  ui.board.classList.toggle('instant', instant);
  ui.board.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  if (instant) {
    ui.board.getBoundingClientRect();
    ui.board.classList.remove('instant');
  }
}

// Точка экрана → координаты на текущем листе (в клетках, 0..w по x).
function sheetPoint(clientX, clientY) {
  const rect = ui.table.getBoundingClientRect();
  const { origin } = currentEntry(game);
  return {
    u: (clientX - rect.left - view.tx) / view.cell - origin.x,
    v: (clientY - rect.top - view.ty) / view.cell - origin.y,
  };
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
  hintedKeys = new Set();
  animating = false;
  drag = null;
  finaleShown = false;
  hintsUsed = 0;
  undos = 0;
  playMs = 0;
  activeSince = null;
  document.querySelector('.stamp')?.remove();
}

function setLevel(next) {
  level = next;
  const { seed, scene } = level.picture;
  const drawn = drawPicture(mulberry32(seed), { w: level.targetW, h: level.targetH, scene });
  picture = { ...drawn, url: pictureUrl(drawn.svg) };
  game = createGame(level);
  const style = ui.table.style;
  style.setProperty('--pic', `url("${picture.url}")`);
  style.setProperty('--tw', level.targetW);
  style.setProperty('--th', level.targetH);
  style.setProperty('--paper-front', level.paper.front);
  style.setProperty('--paper-back', level.paper.back);
}

function startDay(key = todayKey) {
  resetRound();
  mode = 'daily';
  dayKey = key;
  setLevel(dailyLevel(dayDate(key), WORDS));

  const saved = readOnly ? null : store.get(dayStoreKey(key));
  const actions = params.has('play') ? parseActions(params.get('play')) : Array.isArray(saved?.actions) ? saved.actions : [];
  for (const action of actions) {
    if (!isValidAction(action)) break;
    try {
      const next = play(game, action);
      if (next === game) break;
      game = next;
    } catch {
      break; // сохранение от другой версии уровня — начинаем с того, что сошлось
    }
  }
  if (saved) {
    hintsUsed = Number.isInteger(saved.hints) ? saved.hints : 0;
    undos = Number.isInteger(saved.undos) ? saved.undos : 0;
    playMs = Number.isFinite(saved.playMs) ? saved.playMs : 0;
  }
  if (gameStatus(game) === 'solved') finaleShown = true;
  render({ instant: true });
  clockStart();
}

function startPractice() {
  resetRound();
  mode = 'practice';
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const difficulty = DIFFICULTY[2 + Math.floor(Math.random() * 5)]; // как со вторника по субботу
  setLevel({ ...buildLevel(`practice:${seed}`, [difficulty, DIFFICULTY[1]]), word: '', note: '' });
  render({ instant: true });
  clockStart();
}

function startTutorial(index = 0) {
  resetRound();
  mode = 'tutorial';
  tutorialIndex = Math.max(0, Math.min(TUTORIAL.length - 1, index));
  setLevel(tutorialStep().level);
  // в первых шагах сразу показываем, что делать
  if (tutorialIndex < 3) hint = level.solution[0];
  render({ instant: true });
}

function finishTutorial() {
  store.set(TUTORIAL_KEY, true);
  startDay(todayKey);
}

function saveDay(extra = {}) {
  if (mode !== 'daily' || readOnly) return;
  const previous = store.get(dayStoreKey(dayKey)) ?? {};
  store.set(dayStoreKey(dayKey), { ...previous, actions: actionsOf(game), hints: hintsUsed, undos, playMs: elapsed(), ...extra });
}

// ---------- отрисовка ----------

function render({ instant = false, landed = null, focus = undefined } = {}) {
  const focusKey = focus !== undefined ? focus : (document.activeElement?.dataset?.focus ?? null);
  lastWidth = ui.table.clientWidth;
  renderTopbar();
  renderGoal();
  renderBoard({ instant, landed });
  renderFolds();
  renderStatus();
  renderChoices();
  renderControls();
  restoreFocus(focusKey);
}

// Перерисовка заменяет кнопки — возвращаем фокус на «ту же» кнопку.
function restoreFocus(key) {
  if (!key || document.activeElement?.dataset?.focus === key) return;
  const target = document.querySelector(`[data-focus="${key}"]`) ?? document.querySelector('.controls button:not(:disabled)');
  target?.focus({ preventScroll: true });
}

function renderTopbar() {
  ui.album.hidden = mode === 'tutorial';
  ui.sound.textContent = soundOn ? '🔈' : '🔇';
  ui.sound.setAttribute('aria-label', soundOn ? 'Выключить звук' : 'Включить звук');
  const lastSolved = mode === 'tutorial' && tutorialIndex === TUTORIAL.length - 1 && gameStatus(game) === 'solved';
  ui.help.hidden = lastSolved;
  ui.help.textContent = mode === 'tutorial' ? 'Пропустить' : 'Правила';
}

function metaText() {
  if (mode === 'tutorial') return `обучение · ${tutorialIndex + 1} из ${TUTORIAL.length}`;
  if (mode === 'practice') return 'тренировка';
  if (isPast()) return `из альбома · ${longDate(dayKey)}`;
  const streak = currentStreak(stats, realToday());
  return streak > 0 ? `${longDate(dayKey)} · 🔥 ${streak}` : longDate(dayKey);
}

function renderGoal() {
  const { targetW: tw, targetH: th } = level;
  const size = 84;
  const tile = Math.floor(size / Math.max(tw, th));
  ui.target.style.width = `${tile * tw}px`;
  ui.target.style.height = `${tile * th}px`;
  ui.target.style.setProperty('--tile', `${tile}px`);
  ui.target.style.backgroundImage = `url("${picture.url}")`;
  ui.target.classList.toggle('done', gameStatus(game) === 'solved');
  ui.target.setAttribute('aria-label', `Картинка, которую нужно собрать: ${pictureTitle(picture, { emoji: false })}`);
  ui.goal.replaceChildren(
    el('span', 'meta', { textContent: metaText() }),
    el('b', '', { textContent: 'Собери картинку' }),
    el('span', '', {
      textContent:
        level.folds === 0
          ? 'Сгибать не нужно — картинка уже собрана на обороте.'
          : `Сложи лист ${level.w}×${level.h} до ${tw}×${th} ровно за ${level.folds} ${foldsWord(level.folds)}.`,
    }),
  );
}

// Как выглядит грань слоя сверху: бумага нужного цвета и, может быть, кусочек картинки.
function faceNode(layer, className = '') {
  const node = el('div', `face ${layer.flipped ? 'reverse' : 'obverse'} ${className}`.trim());
  const face = level.faces[faceId(layer)];
  if (face) {
    const piece = el('div', 'piece');
    const px = face.piece % level.targetW;
    const py = Math.floor(face.piece / level.targetW);
    piece.style.backgroundPosition = `${level.targetW > 1 ? (px / (level.targetW - 1)) * 100 : 0}% ${
      level.targetH > 1 ? (py / (level.targetH - 1)) * 100 : 0
    }%`;
    if (face.rot ^ (layer.turned ? 1 : 0)) piece.classList.add('upside');
    node.append(piece);
  }
  node.append(el('div', 'shade'));
  return node;
}

const topOf = (stack) => stack[stack.length - 1];

function cardNode(state, origin, x, y, base) {
  const stack = state.stacks[y * state.w + x];
  const card = el('div', 'card');
  card.style.left = `${(origin.x + x) * base}px`;
  card.style.top = `${(origin.y + y) * base}px`;
  card.style.setProperty('--layers', Math.min(stack.length, 6));
  card.dataset.x = x;
  card.dataset.y = y;
  card.append(faceNode(topOf(stack)));
  return card;
}

function renderBoard({ instant = false, landed = null } = {}) {
  const entry = currentEntry(game);
  const { state, origin } = entry;
  const status = gameStatus(game);
  applyView(entry, { instant });
  const base = view.base;
  ui.board.style.setProperty('--base', `${base}px`);
  ui.board.classList.toggle('solved', status === 'solved');
  ui.board.classList.toggle('shown', status === 'solved' && finaleShown);

  const nodes = [];
  const shadow = el('div', 'sheet-shadow');
  Object.assign(shadow.style, {
    left: `${origin.x * base}px`,
    top: `${origin.y * base}px`,
    width: `${state.w * base}px`,
    height: `${state.h * base}px`,
  });
  nodes.push(shadow);

  const landedSet = new Set(landed ?? []);
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      const card = cardNode(state, origin, x, y, base);
      if (landedSet.has(`${x},${y}`)) card.classList.add('landed');
      nodes.push(card);
    }
  }

  if (status === 'playing' && !animating) nodes.push(...creaseNodes(state, origin, base));
  if (hint && !hint.flip && status === 'playing' && !animating) nodes.push(hintArrow(state, origin, base, hint));

  ui.board.replaceChildren(...nodes);
  ui.table.setAttribute(
    'aria-label',
    `Лист ${state.w}×${state.h}. ${status === 'solved' ? 'Картинка собрана.' : 'Потяни край листа, чтобы загнуть его.'}`,
  );
}

// Линии сгиба: по ним можно тапнуть (или выбрать с клавиатуры) и загнуть кнопкой.
function creaseNodes(state, origin, base) {
  const nodes = [];
  for (const axis of ['x', 'y']) {
    const size = axis === 'x' ? state.w : state.h;
    for (let at = 1; at < size; at++) {
      const isSelected = selected && selected.axis === axis && selected.at === at;
      const isHinted = hint && !hint.flip && hint.axis === axis && hint.at === at;
      const crease = el('button', `crease ${axis}${isSelected ? ' selected' : ''}${isHinted ? ' hinted' : ''}`, {
        type: 'button',
      });
      crease.dataset.axis = axis;
      crease.dataset.at = at;
      crease.dataset.focus = `crease-${axis}-${at}`;
      crease.setAttribute(
        'aria-label',
        axis === 'x' ? `Вертикальная линия после ${at}-го столбца` : `Горизонтальная линия после ${at}-й строки`,
      );
      crease.setAttribute('aria-pressed', String(!!isSelected));
      if (axis === 'x') {
        Object.assign(crease.style, {
          left: `${(origin.x + at) * base}px`,
          top: `${origin.y * base}px`,
          height: `${state.h * base}px`,
        });
      } else {
        Object.assign(crease.style, {
          top: `${(origin.y + at) * base}px`,
          left: `${origin.x * base}px`,
          width: `${state.w * base}px`,
        });
      }
      crease.addEventListener('click', () => {
        if (Date.now() < suppressClickUntil) return;
        selected = isSelected ? null : { axis, at };
        render();
      });
      nodes.push(crease);
    }
  }
  return nodes;
}

// Стрелка подсказки: над частью, которую нужно загнуть, в сторону сгиба.
function hintArrow(state, origin, base, move) {
  const size = move.axis === 'x' ? state.w : state.h;
  const [lo, hi] = move.from === 'start' ? [0, move.at] : [move.at, size];
  const mid = (lo + hi) / 2;
  const arrow = el('div', `hint-arrow ${move.axis} ${move.from}`, { textContent: '' });
  if (move.axis === 'x') {
    arrow.style.left = `${(origin.x + mid) * base}px`;
    arrow.style.top = `${(origin.y + state.h / 2) * base}px`;
  } else {
    arrow.style.left = `${(origin.x + state.w / 2) * base}px`;
    arrow.style.top = `${(origin.y + mid) * base}px`;
  }
  return arrow;
}

function renderFolds() {
  const used = foldsUsed(game);
  const dots = [];
  for (let i = 0; i < level.folds; i++) dots.push(el('i', i < used ? 'used' : ''));
  ui.folds.replaceChildren(...dots);
  ui.folds.setAttribute('aria-label', `Сгибов: ${used} из ${level.folds}`);
}

function statusText() {
  const status = gameStatus(game);
  const { state } = currentEntry(game);
  if (mode === 'tutorial') {
    const { text } = tutorialStep();
    if (status === 'solved') return text.solved;
    if (status === 'flip') return 'Картинка собрана снизу — переверни лист!';
    if (status === 'stuck') return text.stuck;
    return text.start;
  }
  if (status === 'solved') return isPast() || mode === 'practice' ? 'Собрано!' : 'Собрано! Слово дня — на печати.';
  if (status === 'flip') return 'Картинка собрана снизу — переверни лист!';
  if (status === 'stuck') {
    const atSize = state.w === level.targetW && state.h === level.targetH;
    return atSize ? 'Лист уже нужного размера, но картинка не та. Отмени сгиб.' : 'Так уже не сложить — отмени сгиб.';
  }
  if (hint?.flip) return 'Подсказка: переверни лист.';
  if (hint) return 'Подсказка: загни часть со стрелкой по красной линии.';
  if (foldsUsed(game) === 0) return 'Потяни край листа, чтобы загнуть. Кусочки бывают и на обороте.';
  const left = foldsLeft(game);
  return `Осталось ${left} ${foldsWord(left)}.`;
}

function renderStatus() {
  ui.status.textContent = statusText();
  ui.status.dataset.tone = gameStatus(game);
}

// После тапа по линии — две кнопки: какую часть загнуть.
function renderChoices() {
  if (!selected || gameStatus(game) !== 'playing' || animating) {
    ui.choices.replaceChildren();
    return;
  }
  const { axis, at } = selected;
  const options =
    axis === 'x'
      ? [
          { from: 'end', label: 'Правую часть', icon: '←' },
          { from: 'start', label: 'Левую часть', icon: '→' },
        ]
      : [
          { from: 'end', label: 'Нижнюю часть', icon: '↑' },
          { from: 'start', label: 'Верхнюю часть', icon: '↓' },
        ];
  ui.choices.replaceChildren(
    ...options.map(({ from, label, icon }) => {
      const move = { axis, at, from };
      const isHinted = hint && sameAction(hint, move);
      return button(label, () => doFold(move), {
        className: `choice${isHinted ? ' hinted' : ''}`,
        focus: `choice-${from}`,
        icon,
      });
    }),
  );
}

function renderControls() {
  const status = gameStatus(game);
  const history = game.history.length;
  const nodes = [];

  if (mode === 'tutorial' && status === 'solved') {
    const last = tutorialIndex === TUTORIAL.length - 1;
    nodes.push(
      button(last ? 'К картинке дня' : 'Дальше', () => (last ? finishTutorial() : startTutorial(tutorialIndex + 1)), {
        className: 'primary wide',
        focus: 'next',
      }),
    );
    ui.controls.replaceChildren(...nodes);
    return;
  }
  if (status === 'solved') {
    if (mode === 'tutorial') return;
    nodes.push(button('Итоги', openSheet, { className: 'primary wide', focus: 'results' }));
    ui.controls.replaceChildren(...nodes);
    return;
  }

  const undoBtn = button('Отменить', () => undoMove(), { focus: 'undo', icon: '↶', className: status === 'stuck' ? 'pulse' : '' });
  undoBtn.disabled = history === 1 || animating;
  const flipBtn = button('Перевернуть', () => doFlip(), {
    focus: 'flip',
    icon: '⇋',
    className: status === 'flip' || hint?.flip ? 'pulse' : '',
  });
  flipBtn.disabled = animating;
  const hintBtn = button('Подсказка', useHint, { focus: 'hint', icon: '✦' });
  hintBtn.disabled = animating || status === 'stuck';
  const restartBtn = button('Заново', restartGame, { focus: 'restart', icon: '⟲' });
  restartBtn.disabled = history === 1 || animating;
  nodes.push(undoBtn, flipBtn, hintBtn, restartBtn);
  ui.controls.replaceChildren(...nodes);
}

// ---------- 3D: часть листа поворачивается вокруг линии ----------
// Перекидываемые клетки собираются в «клапан» — контейнер, который поворачивается
// вокруг линии сгиба (или вокруг середины листа при перевороте). У каждой клетки
// две грани: сверху — что видно сейчас, снизу — оборот нижнего слоя стопки.
//
// Пока тянешь пальцем, линия сгиба может стоять где угодно, даже посреди клетки:
// тогда клетка режется на две части (clip-path) — одна поднимается, другая лежит.
// Так загнутая часть растёт плавно, как у настоящей бумаги, а после отпускания
// линия доезжает до ближайшей линии сетки.
//
// spec — { flip: true } или { axis, from }; угол и линию задаёт set(angle, at).

const EDGE = 0.02; // линия не подходит к краю листа ближе этого

function createFold(entry, spec) {
  const { state, origin } = entry;
  const base = view.base;
  const axis = spec.flip ? 'x' : spec.axis;
  const size = axis === 'x' ? state.w : state.h;
  const offset = axis === 'x' ? origin.x : origin.y;
  const fromStart = spec.flip || spec.from === 'start';
  // знак поворота: часть слева/сверху от линии поднимается к нам
  const sign = fromStart ? 1 : -1;
  const rotate = (deg) => (axis === 'x' ? `rotateY(${sign * deg}deg)` : `rotateX(${-sign * deg}deg)`);
  const backTurn = axis === 'x' ? 'rotateY(180deg)' : 'rotateX(180deg)';
  const lift = spec.flip ? 60 : 3;

  const flap = el('div', `flap ${axis}`);
  const cast = el('div', 'cast');
  const shadow = ui.board.querySelector('.sheet-shadow');
  ui.board.querySelectorAll('.crease, .hint-arrow').forEach((node) => node.remove());
  if (!spec.flip) ui.board.append(cast);
  ui.board.append(flap);

  const originals = new Map();
  ui.board.querySelectorAll('.card:not(.flying)').forEach((card) => originals.set(`${card.dataset.x},${card.dataset.y}`, card));
  const touched = new Set();
  const restore = () => {
    for (const card of touched) {
      card.style.visibility = '';
      card.querySelector('.face').style.clipPath = '';
    }
    touched.clear();
  };

  // Оборот стопки после переворота: нижний слой, другой стороной.
  const underside = (stack) => {
    const bottom = stack[0];
    return { cell: bottom.cell, flipped: !bottom.flipped, turned: axis === 'y' ? !bottom.turned : bottom.turned };
  };

  // Обрезка: keepStart — оставить долю f от начала клетки, иначе — всё после доли f.
  const insets = (keepStart, f) => {
    const cut = `${((keepStart ? 1 - f : f) * 100).toFixed(2)}%`;
    if (axis === 'x') return keepStart ? `inset(0 ${cut} 0 0)` : `inset(0 0 0 ${cut})`;
    return keepStart ? `inset(0 0 ${cut} 0)` : `inset(${cut} 0 0 0)`;
  };
  let splits = []; // [{ front, back, original }] — разрезанные клетки (целый ряд или столбец)
  const applySplits = (f) => {
    for (const split of splits) {
      split.front.style.clipPath = insets(fromStart, f);
      split.back.style.clipPath = insets(!fromStart, 1 - f); // оборот повёрнут — его оси зеркальны
      split.original.querySelector('.face').style.clipPath = insets(!fromStart, f);
    }
  };

  let layoutKey = null;
  const layout = (at) => {
    const key = spec.flip ? 'flip' : Number.isInteger(at) ? `line ${at}` : `cut ${Math.floor(at)}`;
    if (key === layoutKey) return;
    layoutKey = key;
    flap.replaceChildren();
    restore();
    splits = [];
    const cut = spec.flip || Number.isInteger(at) ? null : Math.floor(at);
    for (let y = 0; y < state.h; y++) {
      for (let x = 0; x < state.w; x++) {
        const c = axis === 'x' ? x : y;
        const whole = spec.flip || (fromStart ? c + 1 <= at : c >= at);
        if (!whole && c !== cut) continue;
        const card = cardNode(state, origin, x, y, base);
        card.classList.add('flying');
        const back = faceNode(underside(state.stacks[y * state.w + x]), 'back');
        back.style.transform = backTurn;
        card.append(back);
        flap.append(card);
        const original = originals.get(`${x},${y}`);
        if (!original) continue;
        touched.add(original);
        if (whole) original.style.visibility = 'hidden';
        else splits.push({ front: card.querySelector('.face'), back, original });
      }
    }
  };

  const control = {
    angle: 0,
    at: spec.flip ? size / 2 : null,
    set(angle, at = control.at) {
      control.angle = Math.max(0, Math.min(180, angle));
      control.at = spec.flip ? size / 2 : Math.max(EDGE, Math.min(size - EDGE, at));
      layout(control.at);
      if (splits.length > 0) applySplits(control.at - Math.floor(control.at));

      const pivot = offset + control.at;
      flap.style.transformOrigin = axis === 'x' ? `${pivot * base}px 0` : `0 ${pivot * base}px`;
      const t = control.angle / 180;
      const rise = spec.flip ? Math.sin(Math.PI * t) * lift : lift;
      flap.style.transform = `translateZ(${rise}px) ${rotate(control.angle)}`;
      flap.style.setProperty('--front-shade', (0.5 * t ** 1.3).toFixed(3));
      flap.style.setProperty('--back-shade', (0.5 * (1 - t) ** 1.3).toFixed(3));

      if (!spec.flip) {
        // тень ложится туда, куда опустится поднятая часть
        const [lo, hi] = fromStart ? [0, control.at] : [control.at, size];
        const from = offset + 2 * control.at - hi;
        const to = offset + 2 * control.at - lo;
        const other = axis === 'x' ? [origin.y, state.h] : [origin.x, state.w];
        Object.assign(cast.style, axis === 'x'
          ? { left: `${from * base}px`, width: `${(to - from) * base}px`, top: `${other[0] * base}px`, height: `${other[1] * base}px` }
          : { top: `${from * base}px`, height: `${(to - from) * base}px`, left: `${other[0] * base}px`, width: `${other[1] * base}px` });
        cast.style.opacity = (Math.sin(Math.PI * t * 0.95) * 0.9).toFixed(3);
        // тень листа — под тем, что лежит на столе: неподвижная часть и опустившаяся
        if (shadow) {
          const [keepLo, keepHi] = fromStart ? [control.at, size] : [0, control.at];
          const down = control.angle > 90; // поднятая часть уже над другой половиной
          const first = down ? Math.min(keepLo, 2 * control.at - hi) : 0;
          const last = down ? Math.max(keepHi, 2 * control.at - lo) : size;
          if (axis === 'x') Object.assign(shadow.style, { left: `${(offset + first) * base}px`, width: `${(last - first) * base}px` });
          else Object.assign(shadow.style, { top: `${(offset + first) * base}px`, height: `${(last - first) * base}px` });
        }
      }
    },
    // Плавно довести до угла (и линии). Длительность — по оставшемуся пути.
    animateTo(angle, at, done, { duration = null } = {}) {
      const from = { angle: control.angle, at: control.at };
      const target = { angle, at: at ?? control.at };
      const path = Math.abs(target.angle - from.angle) / 180 + Math.abs(target.at - from.at) * 0.35;
      const ms = duration ?? Math.max(200, path * (spec.flip ? 720 : 520));
      const start = performance.now();
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        control.set(target.angle, target.at);
        done?.();
      };
      const step = (now) => {
        if (finished) return;
        const t = Math.min(1, (now - start) / ms);
        const e = ease(t);
        control.set(from.angle + (target.angle - from.angle) * e, from.at + (target.at - from.at) * e);
        if (t < 1) requestAnimationFrame(step);
        else finish();
      };
      requestAnimationFrame(step);
      // Кадры не приходят, если вкладка скрыта, — ход всё равно завершится.
      setTimeout(finish, ms + 250);
      return ms;
    },
    remove() {
      flap.remove();
      cast.remove();
      restore();
    },
  };
  return control;
}

// Сгиб по линии сетки или переворот: клапан, поставленный в начальное положение.
function buildFlap(entry, action) {
  const control = createFold(entry, action.flip ? { flip: true } : { axis: action.axis, from: action.from });
  control.set(0, action.flip ? undefined : action.at);
  return control;
}

// Где легла перевёрнутая часть — чтобы подсветить «приземление».
function landedKeys(entry, action) {
  const { state, origin } = entry;
  const next = fold(state, action);
  const nextOrigin = originAfterFold(origin, state, action);
  const keys = [];
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      const c = action.axis === 'x' ? x : y;
      if (action.from === 'start' ? c >= action.at : c < action.at) continue;
      const ax = origin.x + x;
      const ay = origin.y + y;
      const pivot = (action.axis === 'x' ? origin.x : origin.y) + action.at;
      const dx = action.axis === 'x' ? 2 * pivot - ax - 1 : ax;
      const dy = action.axis === 'y' ? 2 * pivot - ay - 1 : ay;
      const nx = dx - nextOrigin.x;
      const ny = dy - nextOrigin.y;
      if (nx >= 0 && ny >= 0 && nx < next.w && ny < next.h) keys.push(`${nx},${ny}`);
    }
  }
  return keys;
}

// ---------- ходы ----------

function doFold(move, flap = null) {
  if (animating || gameStatus(game) !== 'playing') return;
  const entry = currentEntry(game);
  selected = null;
  hint = null;
  animating = true;
  ui.choices.replaceChildren();
  const control = flap ?? buildFlap(entry, move);
  const ms = control.animateTo(180, move.at, () => {
    sound('land');
    navigator.vibrate?.(8);
    game = playFold(game, move);
    animating = false;
    control.remove();
    saveDay();
    render({ landed: landedKeys(entry, move) });
    afterMove();
  });
  sound('move', { duration: ms / 1000 });
}

function doFlip() {
  if (animating || gameStatus(game) === 'solved') return;
  const entry = currentEntry(game);
  selected = null;
  if (hint?.flip) hint = null;
  animating = true;
  renderChoices();
  const control = buildFlap(entry, { flip: true });
  const ms = control.animateTo(180, undefined, () => {
    game = playFlip(game);
    animating = false;
    control.remove();
    saveDay();
    render();
    afterMove();
  });
  sound('move', { duration: ms / 1000, flip: true });
}

function afterMove() {
  if (gameStatus(game) === 'solved') onSolved();
}

// Отмена: последний ход проигрывается назад.
function undoMove({ fast = false, counted = true } = {}) {
  return new Promise((resolve) => {
    if (animating || game.history.length === 1) {
      resolve();
      return;
    }
    const { action } = currentEntry(game);
    const previous = undo(game);
    if (counted) undos++;
    selected = null;
    hint = null;
    game = previous;
    render();
    animating = true;
    const control = buildFlap(currentEntry(game), action);
    control.set(180);
    const ms = control.animateTo(0, undefined, () => {
      control.remove();
      animating = false;
      saveDay();
      render();
      resolve();
    }, { duration: fast ? 180 : null });
    sound('move', { duration: ms / 1000, flip: !!action.flip });
  });
}

async function restartGame() {
  if (animating) return;
  undos++;
  while (game.history.length > 1) await undoMove({ fast: true, counted: false });
  saveDay();
}

function useHint() {
  if (animating) return;
  const action = hintAction(game);
  if (!action) return;
  const { state } = currentEntry(game);
  const key = `${state.w}x${state.h}:${JSON.stringify(state.stacks)}`;
  if (!hintedKeys.has(key)) {
    hintedKeys.add(key);
    hintsUsed++;
    saveDay();
  }
  hint = action;
  selected = action.flip ? null : { axis: action.axis, at: action.at };
  render({ focus: action.flip ? 'flip' : `choice-${action.from}` });
}

// ---------- сгиб пальцем ----------
// Нажал на лист и тянешь — как настоящую бумагу за край: поднимается часть от края
// до линии сгиба, а линия идёт посередине между точкой нажатия и пальцем, поэтому
// загнутая часть растёт плавно, ряд за рядом. В начале жеста бумага сначала
// приподнимается (угол растёт за первые полклетки), дальше лежит и тянется за пальцем.
// Отпустил — линия доезжает до ближайшей линии сетки и сгиб доводится,
// а если потянул совсем чуть-чуть — бумага ложится обратно.

const LIFT_CELLS = 0.55; // за сколько клеток пути бумага поднимается до конца

function dragPose(drag) {
  const { state } = currentEntry(game);
  const size = drag.axis === 'x' ? state.w : state.h;
  const grabbed = drag.axis === 'x' ? drag.start.u : drag.start.v;
  const from = drag.delta >= 0 ? 'start' : 'end'; // тянем вправо/вниз — поднимается часть у начала
  const pulled = Math.abs(drag.delta);
  const at = Math.max(EDGE, Math.min(size - EDGE, grabbed + drag.delta / 2));
  const t = Math.min(1, pulled / LIFT_CELLS);
  const angle = 180 * (1 - (1 - t) ** 2);
  // куда ляжет линия, если отпустить: ближайшая линия сетки, так чтобы
  // клетка под пальцем оказалась в поднятой части
  const c0 = Math.floor(grabbed);
  const [lo, hi] = from === 'start' ? [c0 + 1, size - 1] : [1, c0];
  const snap = lo > hi ? null : Math.max(lo, Math.min(hi, Math.round(at)));
  return { from, at, angle, pulled, snap };
}

ui.table.addEventListener('pointerdown', (event) => {
  if (animating || drag || gameStatus(game) !== 'playing') return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const start = sheetPoint(event.clientX, event.clientY);
  const { state } = currentEntry(game);
  if (start.u < -0.3 || start.v < -0.3 || start.u > state.w + 0.3 || start.v > state.h + 0.3) return;
  start.u = Math.max(0.01, Math.min(state.w - 0.01, start.u));
  start.v = Math.max(0.01, Math.min(state.h - 0.01, start.v));
  const now = performance.now();
  drag = {
    id: event.pointerId, x0: event.clientX, y0: event.clientY, start, axis: null, delta: 0,
    side: null, fold: null, voice: null, last: { x: event.clientX, y: event.clientY, t: now }, v: 0,
    sound: { angle: 0, at: 0, t: now },
  };
  try {
    ui.table.setPointerCapture(event.pointerId);
  } catch {
    // не страшно: события и так придут к столу
  }
});

ui.table.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id || animating) return;
  const dx = event.clientX - drag.x0;
  const dy = event.clientY - drag.y0;
  if (!drag.axis) {
    if (Math.hypot(dx, dy) < 8) return;
    drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    selected = null;
    hint = null;
    ui.choices.replaceChildren();
    drag.voice = dragVoice();
  }
  const now = performance.now();
  const along = drag.axis === 'x' ? event.clientX - drag.last.x : event.clientY - drag.last.y;
  const dt = now - drag.last.t;
  if (dt > 0) drag.v = 0.6 * drag.v + 0.4 * (along / dt);
  drag.last = { x: event.clientX, y: event.clientY, t: now };

  drag.delta = (drag.axis === 'x' ? dx : dy) / view.cell;
  const pose = dragPose(drag);
  // сменилась сторона (палец ушёл за точку нажатия) — бумага там лежит, меняем незаметно
  if (pose.from !== drag.side) {
    drag.fold?.remove();
    drag.side = pose.from;
    drag.fold = createFold(currentEntry(game), { axis: drag.axis, from: pose.from });
  }
  drag.fold.set(pose.angle, pose.at);

  // шорох — по скорости бумаги
  const ds = drag.sound;
  const st = Math.max(1, now - ds.t);
  drag.voice?.speed((Math.abs(pose.angle - ds.angle) / 180 + Math.abs(pose.at - ds.at)) / st * 4);
  drag.sound = { angle: pose.angle, at: pose.at, t: now };
});

function endDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const current = drag;
  drag = null;
  current.voice?.stop();
  if (!current.axis) return; // это был тап — его обработает click
  suppressClickUntil = Date.now() + 350;
  const { fold: control } = current;
  if (!control) {
    render();
    return;
  }
  const pose = dragPose(current);
  const fling = current.v * (pose.from === 'start' ? 1 : -1); // скорость в сторону сгиба, px/мс
  const intended = pose.pulled >= 0.45 || (fling > 0.35 && pose.pulled >= 0.15);
  const complete = event.type === 'pointerup' && pose.snap !== null && fling > -0.3 && intended;
  if (complete) {
    doFold({ axis: current.axis, at: pose.snap, from: pose.from }, control);
    return;
  }
  animating = true;
  control.animateTo(0, undefined, () => {
    control.remove();
    animating = false;
    render();
  });
}
ui.table.addEventListener('pointerup', endDrag);
ui.table.addEventListener('pointercancel', endDrag);

// ---------- победа ----------

function currentResult() {
  return {
    word: level.word,
    folds: level.folds,
    hints: hintsUsed,
    undos,
    ms: elapsed(),
    picture: { seed: level.picture.seed, scene: level.picture.scene, w: level.targetW, h: level.targetH },
  };
}

function onSolved() {
  clockStop();
  navigator.vibrate?.([12, 60, 18]);
  if (mode === 'daily' && !readOnly) {
    stats = recordSolve(stats, dayKey, currentResult(), { late: isPast() });
    store.set('skladno:stats', stats);
    saveDay({ solvedAt: Date.now() });
  }
  if (mode === 'tutorial') {
    if (tutorialIndex === TUTORIAL.length - 1) store.set(TUTORIAL_KEY, true);
    finaleShown = true;
    render();
    return;
  }
  // Кусочки срастаются в картинку, потом сверху ставится печать со словом.
  setTimeout(() => {
    finaleShown = true;
    ui.board.classList.add('shown');
    if (level.word) stamp(level.word);
  }, 650);
  renderGoal();
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(openSheet, level.word ? 2300 : 1300);
}

// Печать ставится в правый нижний угол картинки, как на гравюрах.
function stamp(word) {
  document.querySelector('.stamp')?.remove();
  const { state, origin } = currentEntry(game);
  const width = state.w * view.cell;
  const right = view.tx + (origin.x + state.w) * view.cell;
  const bottom = view.ty + (origin.y + state.h) * view.cell;
  const node = el('div', 'stamp', { textContent: word, ariaHidden: 'true' });
  const letters = [...word].length;
  node.style.fontSize = `${Math.round((width * 0.5) / Math.max(4, letters) / 0.78)}px`;
  node.style.right = `${ui.table.clientWidth - right + width * 0.05}px`;
  node.style.bottom = `${ui.table.clientHeight - bottom + width * 0.06}px`;
  ui.table.append(node);
  setTimeout(() => sound('stamp'), 260);
}

function stat(value, label) {
  const node = el('div', 'stat');
  node.append(el('b', '', { textContent: value }), el('span', '', { textContent: label }));
  return node;
}

function thumb(pic, word, className = '') {
  const node = el('div', `thumb ${className}`.trim());
  if (pic) {
    const drawn = drawPicture(mulberry32(pic.seed), { w: pic.w, h: pic.h, scene: pic.scene });
    node.append(el('img', '', { src: pictureUrl(drawn.svg), alt: pictureTitle(drawn, { emoji: false }) }));
  }
  if (word) node.append(el('span', 'seal', { textContent: word }));
  return node;
}

function openSheet() {
  clearTimeout(sheetTimer);
  if (ui.sheet.open || mode === 'tutorial' || gameStatus(game) !== 'solved') return;
  const result = (mode === 'daily' && !readOnly && stats.days[dayKey]) || currentResult();
  const streak = currentStreak(stats, realToday());
  const hints = result.hints ?? 0;
  const undoCount = result.undos ?? 0;
  const note = mode === 'daily' ? entryFor(dayDate(dayKey), WORDS).note : '';

  const nodes = [closeButton(), el('h2', '', { id: 'sheet-title', textContent: 'Складно!', tabIndex: -1, autofocus: true })];
  const card = el('div', 'result-card');
  card.append(thumb(result.picture ?? currentResult().picture, level.word, 'big'));
  const caption = el('div', 'result-caption');
  caption.append(el('p', 'picture-title', { textContent: pictureTitle(picture) }));
  if (level.word) caption.append(el('p', 'big-word', { textContent: level.word }));
  if (note) caption.append(el('p', 'note', { textContent: note }));
  card.append(caption);
  nodes.push(card);

  const grid = el('div', 'stats');
  grid.append(
    stat(result.ms ? formatDuration(result.ms) : '—', 'время'),
    stat(String(hints), plural(hints, ['подсказка', 'подсказки', 'подсказок'])),
    stat(String(undoCount), plural(undoCount, ['отмена', 'отмены', 'отмен'])),
  );
  if (mode === 'daily') grid.append(stat(`🔥 ${streak}`, `лучшая: ${Math.max(stats.best, streak)}`));
  nodes.push(grid);

  const actions = el('div', 'sheet-actions');
  if (mode === 'daily' && !isPast()) {
    const next = el('p', 'next');
    next.append('Новая картинка через ', el('b', '', { textContent: '—' }));
    nodes.push(next);
    const shareButton = button('Поделиться', () => share(shareButton, { ...result, hints, undos: undoCount }, streak), {
      className: 'primary',
    });
    actions.append(shareButton, button('Альбом', openAlbum));
  } else if (mode === 'daily') {
    actions.append(button('Альбом', openAlbum, { className: 'primary' }), button('К сегодняшней', () => startDay(todayKey)));
  } else {
    actions.append(button('Ещё уровень', startPractice, { className: 'primary' }), button('К картинке дня', () => startDay(todayKey)));
  }
  nodes.push(actions);

  ui.sheet.className = 'sheet';
  ui.sheet.replaceChildren(...nodes);
  ui.sheet.showModal();
  startCountdown();
}

function closeButton() {
  const close = el('button', 'sheet-close', { type: 'button', textContent: '×' });
  close.setAttribute('aria-label', 'Закрыть');
  close.addEventListener('click', () => ui.sheet.close());
  return close;
}

function startCountdown() {
  clearInterval(countdownTimer);
  const node = ui.sheet.querySelector('.next b');
  if (!node) return;
  const tick = () => {
    const now = new Date();
    if (!debugDate && dateKey(now) !== todayKey) {
      node.textContent = 'уже готова';
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
    dateLabel: shortDate(dayKey),
    title: pictureTitle(picture),
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

// ---------- альбом ----------
// Все дни с 1 ноября 2026: собранные — картинкой с печатью, пропущенные можно сыграть.

function openAlbum() {
  if (animating) return;
  clearInterval(countdownTimer);
  const days = new Map(collectedDays(stats).map((day) => [day.date, day]));
  const keys = [];
  for (let key = realToday(); key >= FIRST_DAY; key = addDays(key, -1)) keys.push(key);

  const grid = el('div', 'album-grid');
  for (const key of keys) {
    const day = days.get(key);
    const isToday = key === realToday();
    const item = el('button', `album-item${day ? ' solved' : ''}`, { type: 'button' });
    item.append(
      day ? thumb(day.picture, day.word) : el('div', 'thumb empty', { textContent: isToday ? 'сегодня' : '?' }),
      el('span', 'album-date', { textContent: shortDate(key) }),
    );
    item.addEventListener('click', () => {
      if (day && day.picture) openMemory(key, day);
      else {
        ui.sheet.close();
        startDay(key);
      }
    });
    grid.append(item);
  }
  const solvedCount = keys.filter((key) => days.has(key)).length;
  ui.sheet.className = 'sheet album';
  ui.sheet.replaceChildren(
    closeButton(),
    el('h2', '', { id: 'sheet-title', textContent: 'Альбом', tabIndex: -1, autofocus: true }),
    el('p', 'album-sub', {
      textContent: `Собрано ${solvedCount} из ${keys.length}. Пропущенный день можно сыграть — на серию он не влияет.`,
    }),
    grid,
  );
  if (!ui.sheet.open) ui.sheet.showModal();
}

function openMemory(key, day) {
  const note = entryFor(dayDate(key), WORDS).note;
  const drawn = drawPicture(mulberry32(day.picture.seed), { w: day.picture.w, h: day.picture.h, scene: day.picture.scene });
  const back = button('Назад к альбому', openAlbum);
  const nodes = [
    closeButton(),
    el('h2', '', { id: 'sheet-title', textContent: longDate(key), tabIndex: -1, autofocus: true }),
    thumb(day.picture, day.word, 'big'),
    el('p', 'picture-title', { textContent: pictureTitle(drawn) }),
    el('p', 'big-word', { textContent: day.word }),
  ];
  if (note) nodes.push(el('p', 'note', { textContent: note }));
  const actions = el('div', 'sheet-actions');
  actions.append(back);
  nodes.push(actions);
  ui.sheet.className = 'sheet memory';
  ui.sheet.replaceChildren(...nodes);
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
  if (debugDate || animating || drag) return;
  if (realToday() !== todayKey) {
    saveDay();
    location.reload();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    clockStop();
    saveDay();
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
ui.album.addEventListener('click', openAlbum);
ui.sound.addEventListener('click', () => {
  soundOn = !soundOn;
  store.set('skladno:sound', soundOn);
  renderTopbar();
  sound('land');
});

// Тап мимо линии и кнопок — снять выбор линии.
document.addEventListener('click', (event) => {
  if (!selected || animating || Date.now() < suppressClickUntil) return;
  if (event.target.closest('.crease, .choice, .btn, .chip, dialog')) return;
  selected = null;
  render();
});

const ARROWS = {
  ArrowRight: { axis: 'x', from: 'start' },
  ArrowLeft: { axis: 'x', from: 'end' },
  ArrowDown: { axis: 'y', from: 'start' },
  ArrowUp: { axis: 'y', from: 'end' },
};

document.addEventListener('keydown', (event) => {
  if (ui.sheet.open || animating) return;
  if (event.key === 'Escape' && selected) {
    selected = null;
    render();
  } else if (selected && ARROWS[event.key]?.axis === selected.axis) {
    event.preventDefault();
    doFold({ ...selected, from: ARROWS[event.key].from });
  } else if (event.code === 'KeyZ' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    undoMove();
  } else if (event.code === 'KeyF' && !event.ctrlKey && !event.metaKey) {
    doFlip();
  }
});

// Перерисовываем только при смене ширины: на iOS resize приходит и от адресной строки.
window.addEventListener('resize', () => {
  if (!level || animating || drag || ui.table.clientWidth === lastWidth) return;
  render({ instant: true });
});

// ---------- старт ----------

if (!reloading) {
  const debug = readOnly;
  if (params.has('tutorial') || (!debug && !store.get(TUTORIAL_KEY))) startTutorial(Number(params.get('tutorial')) || 0);
  else startDay(todayKey);
  if (params.has('demo')) runDemo(parseActions(params.get('demo')));
}

async function runDemo(actions) {
  for (const action of actions) {
    await wait(700);
    if (action.flip) doFlip();
    else {
      selected = { axis: action.axis, at: action.at };
      render();
      await wait(500);
      doFold(action);
    }
    await wait(1100);
  }
}
