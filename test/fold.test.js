import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  apply,
  applyMoves,
  createSheet,
  faceId,
  flipSheet,
  fold,
  layerCode,
  minFolds,
  physicalKey,
  possibleMoves,
  stateKey,
  topLayers,
} from '../src/fold.js';
import { mulberry32, pick } from '../src/rng.js';

const L = (cell, flipped = false, turned = false) => ({ cell, flipped, turned });

describe('createSheet', () => {
  test('каждая клетка лежит лицом вверх в своей позиции', () => {
    assert.deepEqual(createSheet(3), { w: 3, h: 1, stacks: [[L(0)], [L(1)], [L(2)]] });
  });

  test('лист 2×2 нумеруется построчно', () => {
    assert.deepEqual(createSheet(2, 2).stacks, [[L(0)], [L(1)], [L(2)], [L(3)]]);
  });

  test('неверный размер', () => {
    assert.throws(() => createSheet(0), RangeError);
    assert.throws(() => createSheet(2, 0), RangeError);
    assert.throws(() => createSheet(1.5), RangeError);
  });
});

describe('fold полоски', () => {
  test('левая часть ложится на правую изнанкой и зеркально', () => {
    //  0 1 | 2 3 4 5   →   1' 0' 4 5   (под ними 2 и 3)
    const s = fold(createSheet(6), { axis: 'x', at: 2, from: 'start' });
    assert.equal(s.w, 4);
    assert.deepEqual(s.stacks, [[L(2), L(1, true)], [L(3), L(0, true)], [L(4)], [L(5)]]);
  });

  test('правая часть ложится на левую и свешивается', () => {
    //  0 1 | 2 3 4 5   →   5' 4' 3' 2'   (под 3' и 2' лежат 0 и 1)
    const s = fold(createSheet(6), { axis: 'x', at: 2, from: 'end' });
    assert.equal(s.w, 4);
    assert.deepEqual(s.stacks, [[L(5, true)], [L(4, true)], [L(0), L(3, true)], [L(1), L(2, true)]]);
  });

  test('два сгиба: слои переворачиваются вместе со стопкой', () => {
    let s = fold(createSheet(4), { axis: 'x', at: 2, from: 'start' });
    assert.deepEqual(s.stacks, [[L(2), L(1, true)], [L(3), L(0, true)]]);
    s = fold(s, { axis: 'x', at: 1, from: 'start' });
    assert.equal(s.w, 1);
    assert.deepEqual(s.stacks, [[L(3), L(0, true), L(1), L(2, true)]]);
  });

  test('не меняет исходное состояние', () => {
    const before = createSheet(5);
    const copy = structuredClone(before);
    fold(before, { axis: 'x', at: 2, from: 'end' });
    assert.deepEqual(before, copy);
  });

  test('неверный сгиб', () => {
    const s = createSheet(4);
    assert.throws(() => fold(s, { axis: 'x', at: 0, from: 'start' }), RangeError);
    assert.throws(() => fold(s, { axis: 'x', at: 4, from: 'start' }), RangeError);
    assert.throws(() => fold(s, { axis: 'y', at: 1, from: 'start' }), RangeError);
    assert.throws(() => fold(s, { axis: 'z', at: 1, from: 'start' }), RangeError);
    assert.throws(() => fold(s, { axis: 'x', at: 1, from: 'left' }), RangeError);
  });
});

describe('fold листа 2D', () => {
  test('верхняя строка ложится на нижнюю', () => {
    //  0 1          2 3  (сверху 0' 1')
    //  ---    →
    //  2 3
    // при сгибе по горизонтальной линии рисунок оборота оказывается вверх ногами
    const s = fold(createSheet(2, 2), { axis: 'y', at: 1, from: 'start' });
    assert.deepEqual(s, { w: 2, h: 1, stacks: [[L(2), L(0, true, true)], [L(3), L(1, true, true)]] });
  });

  test('вертикальный сгиб складывает каждую строку', () => {
    //  0 | 1 2       1 2   (на 1 лежит 0')
    //  3 | 4 5  →    4 5   (на 4 лежит 3')
    const s = fold(createSheet(3, 2), { axis: 'x', at: 1, from: 'start' });
    assert.deepEqual(s, { w: 2, h: 2, stacks: [[L(1), L(0, true)], [L(2)], [L(4), L(3, true)], [L(5)]] });
  });
});

describe('possibleMoves', () => {
  test('полоска из 5: 4 линии × 2 стороны', () => {
    assert.equal(possibleMoves(createSheet(5)).length, 8);
  });

  test('одна клетка — сгибать нечего', () => {
    assert.deepEqual(possibleMoves(createSheet(1)), []);
  });

  test('лист 3×2: по обеим осям', () => {
    const moves = possibleMoves(createSheet(3, 2));
    assert.equal(moves.filter((m) => m.axis === 'x').length, 4);
    assert.equal(moves.filter((m) => m.axis === 'y').length, 2);
  });
});

test('при любых сгибах каждая клетка остаётся ровно в одном слое', () => {
  const rand = mulberry32(42);
  for (let round = 0; round < 200; round++) {
    let s = createSheet(1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 4));
    const cells = s.w * s.h;
    for (let moves = possibleMoves(s); moves.length > 0; moves = possibleMoves(s)) {
      s = fold(s, pick(rand, moves));
      assert.ok(s.stacks.every((stack) => stack.length > 0), 'пустая позиция');
      const seen = s.stacks.flat().map((layer) => layer.cell).sort((a, b) => a - b);
      assert.deepEqual(seen, [...Array(cells).keys()]);
    }
  }
});

test('applyMoves применяет сгибы по порядку', () => {
  const moves = [
    { axis: 'x', at: 2, from: 'start' },
    { axis: 'x', at: 1, from: 'start' },
  ];
  assert.deepEqual(applyMoves(createSheet(4), moves), fold(fold(createSheet(4), moves[0]), moves[1]));
  assert.deepEqual(applyMoves(createSheet(4), []), createSheet(4));
});

test('topLayers, faceId и stateKey', () => {
  const s = fold(createSheet(3), { axis: 'x', at: 1, from: 'start' });
  assert.deepEqual(topLayers(s), [L(0, true), L(2)]);
  assert.deepEqual(topLayers(s).map(faceId), [1, 4]);

  const same = fold(createSheet(3), { axis: 'x', at: 1, from: 'start' });
  const other = fold(createSheet(3), { axis: 'x', at: 2, from: 'end' });
  assert.equal(stateKey(s), stateKey(same));
  assert.notEqual(stateKey(s), stateKey(other));
});

test('minFolds', () => {
  assert.equal(minFolds(5, 5), 0);
  assert.equal(minFolds(5, 3), 1); // 5 → 3
  assert.equal(minFolds(5, 2), 2); // 5 → 3 → 2
  assert.equal(minFolds(8, 1), 3); // 8 → 4 → 2 → 1
  assert.equal(minFolds(9, 4), 2); // 9 → 5 → 3
});

describe('переворот листа и поворот рисунка', () => {
  test('flipSheet зеркалит столбцы, переворачивает стопки и стороны', () => {
    const s = fold(createSheet(3, 1), { axis: 'x', at: 1, from: 'start' });
    // [1, 0'] [2]  →  [2'] [0, 1']
    assert.deepEqual(flipSheet(s), { w: 2, h: 1, stacks: [[L(2, true)], [L(0), L(1, true)]] });
  });

  test('двойной переворот — исходный лист, а physicalKey у листа и переворота общий', () => {
    const s = fold(createSheet(3, 2), { axis: 'y', at: 1, from: 'end' });
    assert.deepEqual(flipSheet(flipSheet(s)), s);
    assert.equal(physicalKey(s), physicalKey(flipSheet(s)));
    assert.notEqual(stateKey(s), stateKey(flipSheet(s)));
  });

  test('apply: сгиб или переворот', () => {
    const s = createSheet(2, 2);
    assert.deepEqual(apply(s, { flip: true }), flipSheet(s));
    assert.deepEqual(apply(s, { axis: 'x', at: 1, from: 'end' }), fold(s, { axis: 'x', at: 1, from: 'end' }));
  });

  test('flipped и turned совпадают с настоящим поворотом бумаги', () => {
    // Независимо от модели следим за каждой клеткой как за кусочком бумаги:
    // n — куда смотрит лицо (+1 вверх), down — куда смотрит «низ» рисунка по оси y.
    // Сгиб по вертикальной линии и переворот листа отражают x: меняется только n.
    // Сгиб по горизонтальной линии отражает y: меняются n и down.
    // Оборот нарисован так, как его видно после переворота слева направо,
    // поэтому рисунок вверх ногами ровно тогда, когда down < 0.
    const rand = mulberry32(7);
    for (let round = 0; round < 100; round++) {
      let s = createSheet(1 + Math.floor(rand() * 5), 1 + Math.floor(rand() * 5));
      const frames = Array.from({ length: s.w * s.h }, () => ({ n: 1, down: 1 }));
      for (let step = 0; step < 6; step++) {
        const moves = possibleMoves(s);
        const action = moves.length === 0 || rand() < 0.25 ? { flip: true } : pick(rand, moves);
        const moved = new Set();
        s.stacks.forEach((stack, i) => {
          const x = i % s.w;
          const y = Math.floor(i / s.w);
          const c = action.flip ? 0 : action.axis === 'x' ? x : y;
          const isMoving = action.flip || (action.from === 'start' ? c < action.at : c >= action.at);
          if (isMoving) for (const layer of stack) moved.add(layer.cell);
        });
        for (const cell of moved) {
          frames[cell].n *= -1;
          if (!action.flip && action.axis === 'y') frames[cell].down *= -1;
        }
        s = apply(s, action);
        for (const layer of s.stacks.flat()) {
          assert.equal(layer.flipped, frames[layer.cell].n < 0);
          assert.equal(layer.turned, frames[layer.cell].down < 0);
        }
      }
    }
  });

  test('layerCode различает поворот', () => {
    assert.equal(layerCode(L(3)), 12);
    assert.equal(layerCode(L(3, true)), 14);
    assert.equal(layerCode(L(3, true, true)), 15);
  });
});
