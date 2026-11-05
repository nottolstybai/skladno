// Решатель.
//
// Сгибы зависят только от геометрии, поэтому перебор делится на два шага:
//   1. reachableTops — какие наборы верхних граней вообще можно получить,
//      сложив лист до размера цели, и за сколько сгибов минимум. Цвета не важны,
//      поэтому результат один для всех уровней одного размера и кэшируется.
//   2. solve — какие из этих наборов дают нужный узор.

import { createSheet, faceId, fold, minFolds, possibleMoves, stateKey, topLayers } from './fold.js';

const cache = new Map();

// Успеет ли лист дойти до размера цели за `remaining` сгибов.
export function canReachSize(state, { targetW, targetH }, remaining) {
  return (
    state.w >= targetW &&
    state.h >= targetH &&
    minFolds(state.w, targetW) + minFolds(state.h, targetH) <= remaining
  );
}

// Все наборы верхних граней для листа w×h, сложенного до targetW×targetH
// не больше чем за maxDepth сгибов. Перебор в ширину, одинаковые состояния — один раз.
// Возвращает массив { faces: номера верхних граней, depth: минимум сгибов, path: сгибы },
// упорядоченный по depth. Результат общий (из кэша) — не изменяйте его.
export function reachableTops({ w, h, targetW, targetH }, maxDepth) {
  const cacheKey = `${w}x${h}→${targetW}x${targetH}≤${maxDepth}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const target = { targetW, targetH };
  const canReach = (s, remaining) => canReachSize(s, target, remaining);

  const start = createSheet(w, h);
  const seen = new Set([stateKey(start)]);
  const tops = new Map();
  let frontier = canReach(start, maxDepth) ? [{ state: start, path: [] }] : [];

  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
    const next = [];
    for (const { state, path } of frontier) {
      if (state.w === targetW && state.h === targetH) {
        const faces = topLayers(state).map(faceId);
        const key = faces.join(',');
        if (!tops.has(key)) tops.set(key, { faces, depth, path });
        continue; // дальше лист только уменьшится
      }
      if (depth === maxDepth) continue;
      for (const move of possibleMoves(state)) {
        const folded = fold(state, move);
        if (!canReach(folded, maxDepth - depth - 1)) continue;
        const key = stateKey(folded);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ state: folded, path: [...path, move] });
      }
    }
    frontier = next;
  }

  const result = [...tops.values()];
  cache.set(cacheKey, result);
  return result;
}

// Ищет, как получить узор уровня не больше чем за maxDepth сгибов.
//   minDepth     — наименьшее число сгибов (null — никак);
//   solution     — одна кратчайшая последовательность сгибов (null — никак);
//   arrangements — сколько разных наборов верхних граней дают этот узор.
//                  Если больше одного, можно собрать узор, но не то слово.
export function solve(level, maxDepth = level.folds) {
  const matching = reachableTops(level, maxDepth).filter((top) =>
    top.faces.every((id, i) => level.faces[id].color === level.target[i]),
  );
  if (matching.length === 0) return { minDepth: null, solution: null, arrangements: 0 };
  return { minDepth: matching[0].depth, solution: [...matching[0].path], arrangements: matching.length };
}
