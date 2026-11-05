// Генератор уровня.
//
// Сгибы зависят только от геометрии, а не от цветов, поэтому уровень строится так:
//   1. Решатель перебирает, какие наборы верхних граней можно получить,
//      сложив полоску до длины слова (один раз на размер, дальше из кэша).
//   2. Берём случайный набор, который нельзя получить быстрее, чем за `folds` сгибов.
//      На эти грани пишем буквы слова, их цвета и есть узор-цель.
//      Остальные грани красим случайно.
//   3. Проверяем, что никакой другой набор граней (в том числе за меньшее
//      число сгибов) не даёт тот же узор — иначе сложится не то слово.
//   4. Не подошло — пробуем другой набор и другие цвета.

import { pick, randInt } from './rng.js';
import { reachableTops } from './solver.js';

// Цвет изнанки у односторонней бумаги.
export const WHITE = 0;

export function generateLevel(rand, { word, length, folds, colors, twoSided, attempts = 1000 }) {
  const letters = [...word];
  if (length <= letters.length) {
    throw new RangeError(`strip of ${length} is too short for word ${word}`);
  }

  const size = { w: length, h: 1, targetW: letters.length, targetH: 1 };
  const tops = reachableTops(size, folds);
  const candidates = tops.filter((top) => top.depth === folds);
  if (candidates.length === 0) {
    throw new RangeError(`can't fold ${length} into ${letters.length} with exactly ${folds} folds`);
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const answer = pick(rand, candidates);

    const faces = [];
    for (let cell = 0; cell < length; cell++) {
      faces.push({ color: 1 + randInt(rand, colors), letter: '' });
      faces.push({ color: twoSided ? 1 + randInt(rand, colors) : WHITE, letter: '' });
    }
    const target = answer.faces.map((id) => faces[id].color);
    if (new Set(target).size < 2) continue; // однотонный узор — скучно

    const ambiguous = tops.some(
      (top) => top !== answer && top.faces.every((id, i) => faces[id].color === target[i]),
    );
    if (ambiguous) continue;

    answer.faces.forEach((id, i) => {
      faces[id].letter = letters[i];
    });
    return { ...size, faces, target, folds, word, solution: [...answer.path] };
  }
  throw new Error(`no good level for ${word} (length ${length}, ${folds} folds)`);
}
