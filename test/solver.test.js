import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyMoves, createSheet, flipSheet, fold, possibleMoves } from '../src/fold.js';
import { isSolved, visiblePieces } from '../src/level.js';
import { reachableTops, showsPicture, solve, topCodes } from '../src/solver.js';

const X = (at, from = 'start') => ({ axis: 'x', at, from });
const FLIP = { flip: true };

// Уровень 4×1 → 3×1: кусочки на гранях по номерам граней.
function strip(faces, folds = 1) {
  return { w: 4, h: 1, targetW: 3, targetH: 1, folds, faces, solution: [] };
}

describe('level', () => {
  // Сгиб X(1): сверху оборот клетки 0 (грань 1), лица клеток 2 и 3 (грани 4 и 6).
  const faces = [null, { piece: 0, rot: 0 }, null, null, { piece: 1, rot: 0 }, null, { piece: 2, rot: 1 }, null];

  test('visiblePieces показывает кусочки верхних граней с поворотом', () => {
    assert.deepEqual(visiblePieces(createSheet(4), strip(faces)), [null, null, { piece: 1, rot: 0 }, { piece: 2, rot: 1 }]);
    const s = fold(createSheet(4), X(1));
    assert.deepEqual(visiblePieces(s, strip(faces)), [{ piece: 0, rot: 0 }, { piece: 1, rot: 0 }, { piece: 2, rot: 1 }]);
  });

  test('isSolved: размер, кусочки на своих местах и ровно', () => {
    const level = strip(faces);
    assert.equal(isSolved(fold(createSheet(4), X(1)), level), false, 'кусочек 2 вверх ногами');
    const fixed = strip(faces.map((f) => (f && f.piece === 2 ? { piece: 2, rot: 0 } : f)));
    assert.equal(isSolved(fold(createSheet(4), X(1)), fixed), true);
    assert.equal(isSolved(createSheet(4), fixed), false, 'не тот размер');
  });

  test('кусочек с оборота после сгиба по горизонтали ложится ровно, если напечатан вверх ногами', () => {
    // 1×2 → 1×1: нижняя клетка загибается вверх, сверху оборот клетки 1, повёрнутый.
    const s = fold(createSheet(1, 2), { axis: 'y', at: 1, from: 'end' });
    const level = { w: 1, h: 2, targetW: 1, targetH: 1, folds: 1, faces: [null, null, null, { piece: 0, rot: 1 }] };
    assert.equal(isSolved(s, level), true);
  });
});

describe('solve', () => {
  test('находит единственный сгиб', () => {
    const faces = [null, { piece: 0, rot: 0 }, null, null, { piece: 1, rot: 0 }, null, { piece: 2, rot: 0 }, null];
    assert.deepEqual(solve(strip(faces)), { minDepth: 1, solution: [X(1)], arrangements: 1 });
  });

  test('картинка на обороте — нужен переворот листа', () => {
    // 2×1, картинка 2×1 на обороте: после переворота клетки меняются местами.
    const level = { w: 2, h: 1, targetW: 2, targetH: 1, folds: 0, faces: [null, { piece: 1, rot: 0 }, null, { piece: 0, rot: 0 }] };
    assert.deepEqual(solve(level), { minDepth: 0, solution: [FLIP], arrangements: 1 });
    assert.equal(isSolved(flipSheet(createSheet(2)), level), true);
  });

  test('невозможная картинка', () => {
    assert.deepEqual(solve(strip(new Array(8).fill(null))), { minDepth: null, solution: null, arrangements: 0 });
  });

  test('showsPicture', () => {
    const faces = [{ piece: 0, rot: 1 }, null, { piece: 1, rot: 0 }];
    assert.equal(showsPicture([1, 4], faces), true); // грань 0 повёрнута — ровно
    assert.equal(showsPicture([0, 4], faces), false);
    assert.equal(showsPicture([1, 2], faces), false); // пустая грань
  });
});

describe('reachableTops', () => {
  // Перебор «в лоб»: все последовательности сгибов, между ними — переворот или нет.
  function bruteForce(w, h, targetW, targetH, maxDepth, flips) {
    const best = new Map();
    const note = (state, depth) => {
      const key = topCodes(state).join(',');
      if (!best.has(key) || best.get(key) > depth) best.set(key, depth);
    };
    (function walk(state, depth) {
      const sides = flips ? [state, flipSheet(state)] : [state];
      if (state.w === targetW && state.h === targetH) sides.forEach((side) => note(side, depth));
      if (depth === maxDepth) return;
      for (const side of sides) for (const move of possibleMoves(side)) walk(fold(side, move), depth + 1);
    })(createSheet(w, h), 0);
    return best;
  }

  for (const [w, h, targetW, targetH, maxDepth] of [
    [6, 1, 3, 1, 3],
    [3, 3, 2, 2, 3],
    [4, 3, 2, 2, 3],
  ]) {
    for (const flips of [true, false]) {
      test(`совпадает с перебором в лоб: ${w}×${h} → ${targetW}×${targetH} за ≤ ${maxDepth}${flips ? '' : ', без переворота'}`, () => {
        const tops = reachableTops({ w, h, targetW, targetH }, maxDepth, { flips });
        const expected = bruteForce(w, h, targetW, targetH, maxDepth, flips);
        assert.deepEqual(new Map(tops.map((t) => [t.codes.join(','), t.depth])), expected);

        for (const top of tops) {
          assert.equal(top.path.filter((a) => !a.flip).length, top.depth);
          if (!flips) assert.ok(top.path.every((a) => !a.flip));
          assert.deepEqual(topCodes(applyMoves(createSheet(w, h), top.path)), top.codes);
        }
        const depths = tops.map((t) => t.depth);
        assert.deepEqual(depths, [...depths].sort((a, b) => a - b), 'упорядочено по числу сгибов');
      });
    }
  }

  test('лист меньше цели — ничего', () => {
    assert.deepEqual(reachableTops({ w: 2, h: 1, targetW: 3, targetH: 1 }, 3), []);
  });
});
