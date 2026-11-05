// Детерминированный генератор случайных чисел.
// Одинаковый seed → одинаковая последовательность, поэтому уровень дня
// у всех и всегда получается одним и тем же, без сервера.

// FNV-1a: строка → 32-битное число (seed).
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: возвращает функцию, которая на каждый вызов даёт число в [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Целое в [0, n).
export function randInt(rand, n) {
  return Math.floor(rand() * n);
}

export function pick(rand, items) {
  return items[randInt(rand, items.length)];
}
