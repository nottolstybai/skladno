import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyMoves, createSheet } from '../src/fold.js';
import { generateLevel } from '../src/generator.js';
import { isSolved } from '../src/level.js';
import { mulberry32 } from '../src/rng.js';
import { solve } from '../src/solver.js';

describe('generateLevel', () => {
  const configs = [
    { w: 3, h: 3, targetW: 2, targetH: 2, folds: 2, decoys: 2, flips: 0 },
    { w: 4, h: 3, targetW: 2, targetH: 2, folds: 3, decoys: 3, flips: 0 },
    { w: 4, h: 4, targetW: 2, targetH: 2, folds: 3, decoys: 4, flips: 1 },
    { w: 5, h: 4, targetW: 3, targetH: 2, folds: 3, decoys: 5, flips: 0.5 },
    { w: 6, h: 1, targetW: 3, targetH: 1, folds: 2, decoys: 2, flips: 0.5 },
  ];

  for (const config of configs) {
    const name = `${config.w}×${config.h} → ${config.targetW}×${config.targetH}, ${config.folds} сгиба`;
    test(`${name}: решается ровно за столько сгибов и единственным способом`, () => {
      for (let seed = 0; seed < 15; seed++) {
        const level = generateLevel(mulberry32(seed), config);
        assert.equal(level.faces.length, 2 * config.w * config.h);
        assert.equal(level.solution.filter((a) => !a.flip).length, config.folds);
        if (config.flips === 0) assert.ok(level.solution.every((a) => !a.flip), 'переворот не нужен');

        assert.equal(isSolved(applyMoves(createSheet(level.w, level.h), level.solution), level), true);
        const check = solve(level);
        assert.equal(check.minDepth, config.folds, 'есть решение короче');
        assert.equal(check.arrangements, 1, 'картинка собирается не одним способом');

        const printed = level.faces.filter(Boolean);
        const pieces = config.targetW * config.targetH;
        assert.ok(printed.length >= pieces && printed.length <= pieces + config.decoys);
        for (let p = 0; p < pieces; p++) assert.ok(printed.some((f) => f.piece === p), `нет кусочка ${p}`);
      }
    });
  }

  test('flips: 1 — без переворота не решить', () => {
    for (let seed = 0; seed < 10; seed++) {
      const level = generateLevel(mulberry32(seed), configs[2]);
      assert.equal(solve(level).solution.some((a) => a.flip), true);
    }
  });

  test('один seed — один уровень', () => {
    assert.deepEqual(generateLevel(mulberry32(7), configs[3]), generateLevel(mulberry32(7), configs[3]));
  });

  test('столько сгибов не бывает', () => {
    // 3×3 → 2×2: по одному сгибу на каждую ось, за один сгиб не успеть
    assert.throws(() => generateLevel(mulberry32(1), { ...configs[0], folds: 1 }), RangeError);
  });

  test('картинка больше листа', () => {
    assert.throws(() => generateLevel(mulberry32(1), { ...configs[0], targetW: 4 }), RangeError);
  });
});
