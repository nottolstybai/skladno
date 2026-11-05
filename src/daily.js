// Уровень дня: дата → seed → генератор. Сервер не нужен:
// у всех, кто открыл игру в этот день, получается один и тот же уровень.

import { generateLevel } from './generator.js';
import { PAPERS, SCENE_NAMES } from './picture.js';
import { hashString, mulberry32, pick } from './rng.js';

const MS_PER_DAY = 86_400_000;
const EPOCH_UTC = Date.UTC(2026, 10, 1); // 1 ноября 2026 — день № 0

// Сложность по дню недели (индекс — Date#getDay(), 0 — воскресенье).
//   w, h               — развёрнутый лист
//   targetW, targetH   — картинка
//   folds              — сколько сгибов нужно (ровно столько, быстрее нельзя)
//   decoys             — сколько обманок (лишних копий кусочков)
//   flips              — доля дней, когда без переворота листа не решить
export const DIFFICULTY = [
  { name: 'воскресенье', w: 5, h: 5, targetW: 3, targetH: 3, folds: 4, decoys: 8, flips: 0.7 },
  { name: 'понедельник', w: 3, h: 3, targetW: 2, targetH: 2, folds: 2, decoys: 2, flips: 0 },
  { name: 'вторник', w: 4, h: 3, targetW: 2, targetH: 2, folds: 3, decoys: 3, flips: 0 },
  { name: 'среда', w: 4, h: 4, targetW: 2, targetH: 2, folds: 3, decoys: 4, flips: 0.3 },
  { name: 'четверг', w: 5, h: 4, targetW: 3, targetH: 2, folds: 3, decoys: 5, flips: 0.4 },
  { name: 'пятница', w: 4, h: 4, targetW: 2, targetH: 2, folds: 4, decoys: 6, flips: 0.5 },
  { name: 'суббота', w: 6, h: 4, targetW: 3, targetH: 2, folds: 4, decoys: 7, flips: 0.6 },
];

// Дата по местному времени в виде 'YYYY-MM-DD'.
export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 'YYYY-MM-DD' → Date (полдень по местному времени, чтобы не было сдвигов).
export function parseDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return dateKey(date) === key ? date : null;
}

// Номер дня от 1 ноября 2026 (по местной дате, переход на летнее время не влияет).
export function dayNumber(date) {
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((utc - EPOCH_UTC) / MS_PER_DAY);
}

export function difficultyFor(date) {
  return DIFFICULTY[date.getDay()];
}

// Запись в списке слов — строка или { word, note, date }.
// С датой ('YYYY-MM-DD') слово выпадает ровно в этот день, без даты — по кругу.
export function normalizeEntry(entry) {
  if (typeof entry === 'string') return { word: entry, note: '', date: null };
  return { word: entry.word, note: entry.note ?? '', date: entry.date ?? null };
}

export function entryFor(date, words) {
  const entries = words.map(normalizeEntry);
  const special = entries.find((entry) => entry.date === dateKey(date));
  if (special) return special;
  const regular = entries.filter((entry) => entry.date === null);
  if (regular.length === 0) return { word: '', note: '', date: null };
  const n = regular.length;
  return regular[((dayNumber(date) % n) + n) % n];
}

export function wordFor(date, words) {
  return entryFor(date, words).word;
}

// Дни недели от самого лёгкого к самому сложному.
const EASIEST_FIRST = [1, 2, 3, 4, 5, 6, 0];

// Пробует сложности по порядку и возвращает первый получившийся уровень.
export function generateWithFallback(rand, difficulties) {
  let lastError;
  for (const difficulty of difficulties) {
    try {
      return generateLevel(rand, difficulty);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Готовый уровень по seed: геометрия, бумага, картинка.
export function buildLevel(seedText, difficulties) {
  const rand = mulberry32(hashString(seedText));
  const level = generateWithFallback(rand, difficulties);
  return {
    ...level,
    paper: pick(rand, PAPERS),
    picture: { seed: hashString(`${seedText}:picture`), scene: pick(rand, SCENE_NAMES) },
  };
}

// Уровень дня. Если на сложность этого дня уровень не сложился,
// берём сложность на ступень проще — день без уровня недопустим.
export function dailyLevel(date, words) {
  const { word, note } = entryFor(date, words);
  const upTo = EASIEST_FIRST.indexOf(date.getDay());
  const difficulties = EASIEST_FIRST.slice(0, upTo + 1).reverse().map((i) => DIFFICULTY[i]);
  const level = buildLevel(`skladno:${dateKey(date)}`, difficulties);
  // сцены идут по кругу, чтобы два дня подряд не было одной и той же
  const n = SCENE_NAMES.length;
  const scene = SCENE_NAMES[((dayNumber(date) % n) + n) % n];
  return { ...level, picture: { ...level.picture, scene }, word: word.toUpperCase(), note };
}
