import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSheet, flipSheet, fold, possibleMoves } from '../src/fold.js';
import {
  actionsOf,
  createGame,
  currentEntry,
  foldsLeft,
  foldsUsed,
  gameStatus,
  hintAction,
  landedPositions,
  originAfterFold,
  play,
  playFlip,
  playFold,
  replay,
  restart,
  undo,
} from '../src/game.js';
import { generateLevel } from '../src/generator.js';
import { mulberry32, pick } from '../src/rng.js';
import { scripted } from '../src/tutorial.js';

const config = { w: 4, h: 4, targetW: 2, targetH: 2, folds: 3, decoys: 4 };
const level = generateLevel(mulberry32(11), { ...config, flips: 0 });
const flipLevel = generateLevel(mulberry32(11), { ...config, flips: 1 });
const FLIP = { flip: true };

describe('партия', () => {
  test('начинается с развёрнутого листа', () => {
    const game = createGame(level);
    assert.deepEqual(currentEntry(game), { state: createSheet(4, 4), origin: { x: 0, y: 0 } });
    assert.equal(foldsUsed(game), 0);
    assert.equal(foldsLeft(game), 3);
    assert.equal(gameStatus(game), 'playing');
  });

  test('решение собирает картинку, дальше сгибать нельзя', () => {
    const game = replay(level, level.solution);
    assert.equal(gameStatus(game), 'solved');
    assert.equal(foldsUsed(game), level.folds);
    assert.equal(playFold(game, { axis: 'x', at: 1, from: 'start' }), game);
    assert.equal(playFlip(game), game);
  });

  test('переворот листа не считается сгибом и отменяется', () => {
    const flipped = playFlip(createGame(level));
    assert.equal(foldsUsed(flipped), 0);
    assert.deepEqual(currentEntry(flipped).state, flipSheet(createSheet(4, 4)));
    assert.deepEqual(currentEntry(flipped).origin, { x: 0, y: 0 });
    assert.deepEqual(undo(flipped), createGame(level));
  });

  test('картинка собрана снизу — статус «переверни»', () => {
    const tiny = scripted(2, 1, [{ axis: 'x', at: 1, from: 'start' }, FLIP]);
    const folded = playFold(createGame(tiny), { axis: 'x', at: 1, from: 'start' });
    assert.equal(gameStatus(folded), 'flip');
    assert.deepEqual(hintAction(folded), FLIP);
    assert.equal(gameStatus(playFlip(folded)), 'solved');
  });

  test('тупик виден сразу, не дожидаясь конца сгибов', () => {
    // 4×4 → 2×2 за два сгиба пополам: размер уже как у картинки, а уровень решается за 3
    let halved = playFold(createGame(level), { axis: 'x', at: 2, from: 'start' });
    halved = playFold(halved, { axis: 'y', at: 2, from: 'start' });
    assert.equal(foldsLeft(halved), 1);
    assert.equal(gameStatus(halved), 'stuck');
    assert.equal(playFold(halved, { axis: 'x', at: 1, from: 'start' }), halved);

    // 4 → 3 → 2 → 1: лист стал уже картинки
    let narrow = playFold(createGame(level), { axis: 'x', at: 1, from: 'start' });
    assert.equal(gameStatus(narrow), 'playing');
    narrow = playFold(narrow, { axis: 'x', at: 1, from: 'end' });
    narrow = playFold(narrow, { axis: 'x', at: 1, from: 'end' });
    assert.equal(currentEntry(narrow).state.w, 1);
    assert.equal(gameStatus(narrow), 'stuck');
  });

  test('отмена, «заново» и восстановление по действиям', () => {
    const start = createGame(flipLevel);
    const one = play(start, flipLevel.solution[0]);
    const two = play(one, flipLevel.solution[1]);
    assert.deepEqual(undo(two), one);
    assert.deepEqual(restart(two), start);
    assert.equal(undo(start), start);
    assert.equal(restart(start), start);
    assert.deepEqual(replay(flipLevel, actionsOf(two)), two);
  });

  test('ходы не меняют прошлые состояния', () => {
    const start = createGame(level);
    const snapshot = structuredClone(start);
    playFold(start, level.solution[0]);
    playFlip(start);
    assert.deepEqual(start, snapshot);
  });
});

describe('подсказки', () => {
  for (const [name, lvl] of [['без переворота', level], ['с переворотом', flipLevel]]) {
    test(`ведут к решению: ${name}`, () => {
      let game = createGame(lvl);
      for (let i = 0; i < 2 * lvl.folds + 2 && gameStatus(game) !== 'solved'; i++) {
        const action = hintAction(game);
        assert.ok(action, `нет подсказки на шаге ${i}`);
        game = play(game, action);
      }
      assert.equal(gameStatus(game), 'solved');
      assert.equal(foldsUsed(game), lvl.folds);
      assert.equal(hintAction(game), null);
    });
  }

  test('из перевёрнутого листа тоже', () => {
    let game = playFlip(createGame(level));
    for (let i = 0; i < 2 * level.folds + 2 && gameStatus(game) !== 'solved'; i++) game = play(game, hintAction(game));
    assert.equal(gameStatus(game), 'solved');
  });

  test('из тупика подсказки нет', () => {
    let stuck = playFold(createGame(level), { axis: 'x', at: 2, from: 'start' });
    stuck = playFold(stuck, { axis: 'y', at: 2, from: 'start' });
    assert.equal(hintAction(stuck), null);
  });
});

describe('originAfterFold: неподвижная часть остаётся на месте', () => {
  test('левая часть направо — лист начинается от линии сгиба', () => {
    assert.deepEqual(originAfterFold({ x: 0, y: 0 }, createSheet(6), { axis: 'x', at: 2, from: 'start' }), { x: 2, y: 0 });
  });

  test('правая часть налево и свешивается — лист начинается левее', () => {
    assert.deepEqual(originAfterFold({ x: 0, y: 0 }, createSheet(6), { axis: 'x', at: 2, from: 'end' }), { x: -2, y: 0 });
  });

  test('горизонтальный сгиб двигает по y', () => {
    assert.deepEqual(originAfterFold({ x: 3, y: 0 }, createSheet(2, 3), { axis: 'y', at: 1, from: 'start' }), { x: 3, y: 1 });
  });

  test('при любых сгибах неподвижные стопки не сдвигаются на столе', () => {
    const rand = mulberry32(5);
    for (let round = 0; round < 100; round++) {
      let state = createSheet(2 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 5));
      let origin = { x: 0, y: 0 };
      for (let moves = possibleMoves(state); moves.length > 0; moves = possibleMoves(state)) {
        const move = pick(rand, moves);
        const next = fold(state, move);
        const nextOrigin = originAfterFold(origin, state, move);
        // Неподвижные слои переносятся в новое состояние теми же объектами и лежат в низу стопок.
        const where = new Map();
        state.stacks.forEach((stack, i) => where.set(stack[0], i));
        next.stacks.forEach((stack, i) => {
          if (!where.has(stack[0])) return; // сюда легла только перевёрнутая часть
          const j = where.get(stack[0]);
          assert.equal(origin.x + (j % state.w), nextOrigin.x + (i % next.w));
          assert.equal(origin.y + Math.floor(j / state.w), nextOrigin.y + Math.floor(i / next.w));
        });
        state = next;
        origin = nextOrigin;
      }
    }
  });
});

test('landedPositions — куда легла перевёрнутая часть', () => {
  assert.deepEqual(landedPositions(createSheet(6), { axis: 'x', at: 2, from: 'start' }), [0, 1]);
  assert.deepEqual(landedPositions(createSheet(6), { axis: 'x', at: 2, from: 'end' }), [0, 1, 2, 3]);
  assert.deepEqual(landedPositions(createSheet(6), { axis: 'x', at: 4, from: 'end' }), [2, 3]);

  const rand = mulberry32(9);
  for (let round = 0; round < 100; round++) {
    let state = createSheet(2 + Math.floor(rand() * 5), 2 + Math.floor(rand() * 4));
    for (let moves = possibleMoves(state); moves.length > 0; moves = possibleMoves(state)) {
      const move = pick(rand, moves);
      const coord = (i) => (move.axis === 'x' ? i % state.w : Math.floor(i / state.w));
      const movingCells = new Set();
      state.stacks.forEach((stack, i) => {
        const c = coord(i);
        if (move.from === 'start' ? c < move.at : c >= move.at) for (const layer of stack) movingCells.add(layer.cell);
      });
      const next = fold(state, move);
      const landed = new Set(landedPositions(state, move));
      next.stacks.forEach((stack, i) => {
        const c = move.axis === 'x' ? i % next.w : Math.floor(i / next.w);
        assert.equal(movingCells.has(stack[stack.length - 1].cell), landed.has(c));
      });
      state = next;
    }
  }
});
