// Генератор уровня.
//
// Сгибы зависят только от геометрии, а не от картинки, поэтому уровень строится так:
//   1. Решатель перебирает, какие наборы верхних граней можно получить,
//      сложив лист до размера картинки (один раз на размер, дальше из кэша).
//   2. Берём случайный набор, который нельзя получить быстрее, чем за `folds` сгибов.
//      На его грани печатаем кусочки картинки — так, чтобы в ответе они легли ровно.
//   3. Добавляем обманки: те же кусочки на других гранях. Обманку кладём туда,
//      куда она может попасть при другом складывании — на нужное место и даже ровно,
//      но вместе с остальными кусочками картинка так не соберётся.
//   4. Проверяем, что никакой другой набор граней (в том числе за меньшее
//      число сгибов) не показывает ту же картинку.

import { pick, randInt } from './rng.js';
import { reachableTops, showsPicture } from './solver.js';

// flips — доля уровней, где без переворота листа не обойтись (0 — никогда, 1 — всегда).
export function generateLevel(rand, { w, h, targetW, targetH, folds, decoys = 0, flips = 0, attempts = 300 }) {
  if (targetW > w || targetH > h) throw new RangeError(`picture ${targetW}×${targetH} is bigger than sheet ${w}×${h}`);
  const size = { w, h, targetW, targetH };
  const tops = reachableTops(size, folds);
  const exact = tops.filter((top) => top.depth === folds);
  const exactKeys = new Set(exact.map((top) => top.codes.join(',')));
  // Ответы без переворота — с путём без переворота; остальные требуют перевернуть лист.
  const plain = reachableTops(size, folds, { flips: false }).filter(
    (top) => top.depth === folds && exactKeys.has(top.codes.join(',')),
  );
  const plainKeys = new Set(plain.map((top) => top.codes.join(',')));
  const flipped = exact.filter((top) => !plainKeys.has(top.codes.join(',')));
  if (exact.length === 0 || (flips === 0 && plain.length === 0)) {
    throw new RangeError(`can't fold ${w}×${h} into ${targetW}×${targetH} with exactly ${folds} folds`);
  }

  const pieces = targetW * targetH;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const wantFlip = flips > 0 && rand() < flips;
    const pool = wantFlip ? (flipped.length > 0 ? flipped : plain) : plain.length > 0 ? plain : flipped;
    const answer = pick(rand, pool);
    const faces = new Array(w * h * 2).fill(null);
    answer.codes.forEach((code, p) => {
      faces[code >> 1] = { piece: p, rot: code & 1 };
    });

    let placed = 0;
    for (let tries = 0; placed < decoys && tries < decoys * 20; tries++) {
      const other = pick(rand, tops);
      const p = randInt(rand, pieces);
      const code = other.codes[p];
      if (faces[code >> 1] !== null) continue;
      // Чаще обманка ложится на место ровно — её труднее отличить от настоящей.
      const rot = rand() < 0.65 ? code & 1 : (code & 1) ^ 1;
      faces[code >> 1] = { piece: p, rot };
      placed++;
    }

    const answerKey = answer.codes.join(',');
    const ambiguous = tops.some((top) => top.codes.join(',') !== answerKey && showsPicture(top.codes, faces));
    if (ambiguous) continue;

    return { ...size, folds, faces, solution: [...answer.path] };
  }
  throw new Error(`no good level ${w}×${h} → ${targetW}×${targetH} in ${folds} folds`);
}
