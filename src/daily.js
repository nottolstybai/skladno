// Уровень дня: дата → seed → генератор. Сервер не нужен:
// у всех, кто открыл игру в этот день, получается один и тот же уровень.

import { generateLevel } from './generator.js';
import { hashString, mulberry32 } from './rng.js';

const MS_PER_DAY = 86_400_000;
const EPOCH_UTC = Date.UTC(2026, 10, 1); // 1 ноября 2026 — день № 0

// Сложность по дню недели (индекс — Date#getDay(), 0 — воскресенье).
//   extra     — на сколько клеток полоска длиннее слова
//   folds     — сколько сгибов нужно
//   colors    — сколько цветов в узоре
//   twoSided  — изнанка цветная (иначе белая)
export const DIFFICULTY = [
  { name: 'воскресенье', extra: 5, folds: 4, colors: 4, twoSided: true },
  { name: 'понедельник', extra: 2, folds: 2, colors: 3, twoSided: false },
  { name: 'вторник', extra: 3, folds: 2, colors: 3, twoSided: false },
  { name: 'среда', extra: 3, folds: 2, colors: 4, twoSided: true },
  { name: 'четверг', extra: 4, folds: 3, colors: 3, twoSided: true },
  { name: 'пятница', extra: 4, folds: 3, colors: 4, twoSided: true },
  { name: 'суббота', extra: 5, folds: 3, colors: 4, twoSided: true },
];

// Дата по местному времени в виде 'YYYY-MM-DD'.
export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Номер дня от 1 ноября 2026 (по местной дате, переход на летнее время не влияет).
export function dayNumber(date) {
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((utc - EPOCH_UTC) / MS_PER_DAY);
}

export function difficultyFor(date) {
  return DIFFICULTY[date.getDay()];
}

// Слова идут по порядку списка, по кругу.
export function wordFor(date, words) {
  const n = words.length;
  return words[((dayNumber(date) % n) + n) % n];
}

// Дни недели от самого лёгкого к самому сложному.
const EASIEST_FIRST = [1, 2, 3, 4, 5, 6, 0];

// Пробует сложности по порядку и возвращает первый получившийся уровень.
export function generateWithFallback(rand, word, difficulties) {
  let lastError;
  for (const { extra, folds, colors, twoSided } of difficulties) {
    try {
      return generateLevel(rand, { word, length: word.length + extra, folds, colors, twoSided });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Уровень дня. Если на сложность этого дня уровень не сложился,
// берём сложность на ступень проще — день без уровня недопустим.
export function dailyLevel(date, words) {
  const word = wordFor(date, words).toUpperCase();
  const rand = mulberry32(hashString(`skladno:${dateKey(date)}`));
  const upTo = EASIEST_FIRST.indexOf(date.getDay());
  const difficulties = EASIEST_FIRST.slice(0, upTo + 1).reverse().map((i) => DIFFICULTY[i]);
  return generateWithFallback(rand, word, difficulties);
}
