// Решатель.
//
// Сгибы зависят только от геометрии, поэтому перебор делится на два шага:
//   1. reachableTops — какие наборы верхних граней вообще можно получить,
//      сложив лист до размера цели, и за сколько сгибов минимум. Картинка не важна,
//      поэтому результат один для всех уровней одного размера и кэшируется.
//   2. solve — какие из этих наборов показывают картинку уровня.
//
// Лист можно бесплатно переворачивать (flipSheet), поэтому перебираются положения
// бумаги, а не то, какой стороной она сейчас к игроку: лист и его переворот —
// одно положение. Из каждого положения можно сгибать с любой стороны.

import {
  createSheet,
  flipSheet,
  fold,
  layerCode,
  minFolds,
  physicalKey,
  possibleMoves,
  stateKey,
  topLayers,
} from './fold.js';

const FLIP = Object.freeze({ flip: true });
const cache = new Map();

// Успеет ли лист дойти до размера цели за `remaining` сгибов.
export function canReachSize(state, { targetW, targetH }, remaining) {
  return (
    state.w >= targetW &&
    state.h >= targetH &&
    minFolds(state.w, targetW) + minFolds(state.h, targetH) <= remaining
  );
}

// Что видно сверху: код верхнего слоя в каждой позиции (грань и поворот, см. layerCode).
export function topCodes(state) {
  return topLayers(state).map(layerCode);
}

// Все наборы верхних граней для листа w×h, сложенного до targetW×targetH
// не больше чем за maxDepth сгибов. Перебор в ширину, одинаковые положения — один раз.
// flips: false — без переворотов листа (для простых уровней).
// Возвращает [{ codes, depth: минимум сгибов, path: действия }], по возрастанию depth.
// Результат общий (из кэша) — не изменяйте его.
export function reachableTops({ w, h, targetW, targetH }, maxDepth, { flips = true } = {}) {
  const cacheKey = `${w}x${h}→${targetW}x${targetH}≤${maxDepth}${flips ? '' : ' без переворота'}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const target = { targetW, targetH };
  const start = createSheet(w, h);
  const keyOf = flips ? physicalKey : stateKey;
  const seen = new Set([keyOf(start)]);
  const tops = new Map();
  let frontier = canReachSize(start, target, maxDepth) ? [{ state: start, path: [] }] : [];

  const record = (state, depth, path) => {
    const codes = topCodes(state);
    const key = codes.join(',');
    if (!tops.has(key)) tops.set(key, { codes, depth, path });
  };

  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
    const next = [];
    for (const { state, path } of frontier) {
      const sides = flips ? [[state, path], [flipSheet(state), [...path, FLIP]]] : [[state, path]];
      if (state.w === targetW && state.h === targetH) {
        for (const [side, sidePath] of sides) record(side, depth, sidePath);
        continue; // дальше лист только уменьшится
      }
      if (depth === maxDepth) continue;
      for (const [side, sidePath] of sides) {
        for (const move of possibleMoves(side)) {
          const folded = fold(side, move);
          if (!canReachSize(folded, target, maxDepth - depth - 1)) continue;
          const key = keyOf(folded);
          if (seen.has(key)) continue;
          seen.add(key);
          next.push({ state: folded, path: [...sidePath, move] });
        }
      }
    }
    frontier = next;
  }

  const result = [...tops.values()];
  cache.set(cacheKey, result);
  return result;
}

// Показывает ли набор верхних граней картинку уровня: в позиции p — кусочек p, ровно.
export function showsPicture(codes, faces) {
  return codes.every((code, p) => {
    const face = faces[code >> 1];
    return face != null && face.piece === p && (face.rot ^ (code & 1)) === 0;
  });
}

// Ищет, как собрать картинку уровня не больше чем за maxDepth сгибов.
//   minDepth     — наименьшее число сгибов (null — никак);
//   solution     — одна кратчайшая последовательность действий (null — никак);
//   arrangements — сколько разных наборов верхних граней показывают картинку.
export function solve(level, maxDepth = level.folds) {
  const matching = reachableTops(level, maxDepth).filter((top) => showsPicture(top.codes, level.faces));
  if (matching.length === 0) return { minDepth: null, solution: null, arrangements: 0 };
  return { minDepth: matching[0].depth, solution: [...matching[0].path], arrangements: matching.length };
}
