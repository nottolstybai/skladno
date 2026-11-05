import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSheet, faceId, fold, possibleMoves, topLayers } from '../src/fold.js';
import { isSolved, revealedLetters, visibleColors } from '../src/level.js';
import { reachableTops, solve } from '../src/solver.js';

// Полоска с заданными цветами лица и изнанки каждой клетки.
function makeLevel({ front, back, target, folds = 1, letters = [] }) {
  const faces = [];
  front.forEach((color, i) => {
    faces.push({ color, letter: letters[2 * i] ?? '' });
    faces.push({ color: back[i], letter: letters[2 * i + 1] ?? '' });
  });
  return { w: front.length, h: 1, faces, target, targetW: target.length, targetH: 1, folds, word: '', solution: [] };
}

describe('level', () => {
  const level = makeLevel({
    front: [1, 2, 3, 4],
    back: [9, 8, 7, 6],
    target: [9, 3, 4],
    letters: ['', 'К', 'О', '', 'Т', '', '', ''],
  });

  test('visibleColors показывает верхние грани', () => {
    assert.deepEqual(visibleColors(createSheet(4), level), [1, 2, 3, 4]);
    const s = fold(createSheet(4), { axis: 'x', at: 1, from: 'start' });
    assert.deepEqual(visibleColors(s, level), [9, 3, 4]);
  });

  test('isSolved проверяет и размер, и цвета', () => {
    assert.equal(isSolved(createSheet(4), level), false);
    assert.equal(isSolved(fold(createSheet(4), { axis: 'x', at: 1, from: 'start' }), level), true);
    assert.equal(isSolved(fold(createSheet(4), { axis: 'x', at: 3, from: 'end' }), level), false);
  });

  test('revealedLetters собирает буквы верхних граней', () => {
    const s = fold(createSheet(4), { axis: 'x', at: 1, from: 'start' });
    // сверху: изнанка клетки 0 (К), лицо клетки 2 (Т), лицо клетки 3 (пусто)
    assert.equal(revealedLetters(s, level), 'КТ');
  });
});

describe('solve', () => {
  test('находит единственный сгиб', () => {
    const level = makeLevel({ front: [1, 2, 3, 4], back: [9, 8, 7, 6], target: [9, 3, 4] });
    assert.deepEqual(solve(level), {
      minDepth: 1,
      solution: [{ axis: 'x', at: 1, from: 'start' }],
      arrangements: 1,
    });
  });

  test('узор уже виден — ноль сгибов', () => {
    const level = makeLevel({ front: [1, 2, 3, 4], back: [9, 8, 7, 6], target: [1, 2, 3, 4] });
    assert.deepEqual(solve(level), { minDepth: 0, solution: [], arrangements: 1 });
  });

  test('невозможный узор', () => {
    const level = makeLevel({ front: [1, 2, 3, 4], back: [9, 8, 7, 6], target: [5, 5, 5] });
    assert.deepEqual(solve(level), { minDepth: null, solution: null, arrangements: 0 });
  });

  test('замечает, что узор собирается разными гранями', () => {
    // Изнанка везде белая (0): «белый-белый-белый» дают два разных сгиба.
    const level = makeLevel({ front: [1, 2, 3, 4], back: [0, 0, 0, 0], target: [0, 0, 0] });
    const result = solve(level);
    assert.equal(result.minDepth, 1);
    assert.equal(result.arrangements, 2);
  });

  test('не ищет глубже maxDepth', () => {
    // Из 4 клеток в 1 за один сгиб не сложить, нужно два.
    const level = makeLevel({ front: [1, 2, 3, 4], back: [9, 8, 7, 6], target: [7] });
    assert.equal(solve(level, 1).minDepth, null);
    const result = solve(level, 2);
    assert.equal(result.minDepth, 2);
    const folded = result.solution.reduce((s, m) => fold(s, m), createSheet(4));
    assert.equal(isSolved(folded, level), true);
  });
});

describe('reachableTops', () => {
  // Перебор «в лоб»: все последовательности сгибов, без отсечений и без кэша.
  function bruteForce(w, h, targetW, targetH, maxDepth) {
    const best = new Map();
    (function walk(state, depth) {
      if (state.w === targetW && state.h === targetH) {
        const key = topLayers(state).map(faceId).join(',');
        if (!best.has(key) || best.get(key) > depth) best.set(key, depth);
      }
      if (depth === maxDepth) return;
      for (const move of possibleMoves(state)) walk(fold(state, move), depth + 1);
    })(createSheet(w, h), 0);
    return best;
  }

  for (const [w, h, targetW, targetH, maxDepth] of [
    [6, 1, 3, 1, 3],
    [7, 1, 4, 1, 3],
    [8, 1, 3, 1, 4],
    [3, 3, 2, 2, 3],
  ]) {
    test(`совпадает с перебором в лоб: ${w}×${h} → ${targetW}×${targetH} за ≤ ${maxDepth}`, () => {
      const tops = reachableTops({ w, h, targetW, targetH }, maxDepth);
      const expected = bruteForce(w, h, targetW, targetH, maxDepth);
      assert.deepEqual(new Map(tops.map((t) => [t.faces.join(','), t.depth])), expected);

      for (const top of tops) {
        assert.equal(top.path.length, top.depth);
        const folded = top.path.reduce((s, m) => fold(s, m), createSheet(w, h));
        assert.deepEqual(topLayers(folded).map(faceId), top.faces);
      }
      const depths = tops.map((t) => t.depth);
      assert.deepEqual(depths, [...depths].sort((a, b) => a - b), 'упорядочено по числу сгибов');
    });
  }

  test('лист меньше цели — ничего', () => {
    assert.deepEqual(reachableTops({ w: 2, h: 1, targetW: 3, targetH: 1 }, 3), []);
  });
});
