import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyMoves, createSheet } from '../src/fold.js';
import { generateLevel, WHITE } from '../src/generator.js';
import { isSolved, revealedLetters } from '../src/level.js';
import { mulberry32 } from '../src/rng.js';
import { solve } from '../src/solver.js';

describe('generateLevel', () => {
  const configs = [
    { word: 'ЧАЙ', length: 5, folds: 2, colors: 3, twoSided: false },
    { word: 'КОТИК', length: 8, folds: 2, colors: 3, twoSided: false },
    { word: 'МОРЕ', length: 7, folds: 2, colors: 4, twoSided: true },
    { word: 'ПЛЕД', length: 8, folds: 3, colors: 3, twoSided: true },
    { word: 'ОБНИМУ', length: 11, folds: 4, colors: 4, twoSided: true },
  ];

  for (const config of configs) {
    test(`${config.word}: решается ровно за ${config.folds} сгиба и открывает слово`, () => {
      for (let seed = 0; seed < 30; seed++) {
        const level = generateLevel(mulberry32(seed), config);
        assert.equal(level.w, config.length);
        assert.equal(level.faces.length, 2 * config.length);
        assert.equal(level.solution.length, config.folds);

        const folded = applyMoves(createSheet(level.w), level.solution);
        assert.equal(isSolved(folded, level), true);
        assert.equal(revealedLetters(folded, level), config.word);

        const check = solve(level);
        assert.equal(check.minDepth, config.folds, 'есть решение короче');
        assert.equal(check.arrangements, 1, 'узор собирается не тем словом');

        for (const [i, face] of level.faces.entries()) {
          const isBack = i % 2 === 1;
          if (isBack && !config.twoSided) assert.equal(face.color, WHITE);
          else assert.ok(face.color >= 1 && face.color <= config.colors);
        }
      }
    });
  }

  test('один seed — один уровень', () => {
    const config = configs[3];
    assert.deepEqual(generateLevel(mulberry32(7), config), generateLevel(mulberry32(7), config));
  });

  test('столько сгибов не бывает', () => {
    // 6 → 5: убрать одну клетку можно только одним сгибом
    assert.throws(
      () => generateLevel(mulberry32(1), { word: 'КОТИК', length: 6, folds: 2, colors: 3, twoSided: true }),
      RangeError,
    );
  });

  test('полоска должна быть длиннее слова', () => {
    assert.throws(
      () => generateLevel(mulberry32(1), { word: 'ЛУНА', length: 4, folds: 1, colors: 3, twoSided: true }),
      RangeError,
    );
  });
});
