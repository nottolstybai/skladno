import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSheet, fold, possibleMoves } from '../src/fold.js';
import {
  createGame,
  currentEntry,
  foldsLeft,
  foldsUsed,
  gameStatus,
  hintMove,
  originAfterFold,
  playFold,
  restart,
  undo,
} from '../src/game.js';
import { generateLevel } from '../src/generator.js';
import { bottomColors, revealedLetters, topLetters } from '../src/level.js';
import { mulberry32, pick } from '../src/rng.js';

const level = generateLevel(mulberry32(11), { word: 'ЛУНА', length: 8, folds: 3, colors: 4, twoSided: true });

describe('партия', () => {
  test('начинается с развёрнутого листа', () => {
    const game = createGame(level);
    assert.deepEqual(currentEntry(game), { state: createSheet(8), origin: { x: 0, y: 0 } });
    assert.equal(foldsUsed(game), 0);
    assert.equal(foldsLeft(game), 3);
    assert.equal(gameStatus(game), 'playing');
  });

  test('решение уровня открывает слово, дальше сгибать нельзя', () => {
    let game = createGame(level);
    for (const move of level.solution) game = playFold(game, move);
    assert.equal(gameStatus(game), 'solved');
    assert.equal(foldsUsed(game), level.folds);
    assert.equal(revealedLetters(currentEntry(game).state, level), 'ЛУНА');
    assert.equal(playFold(game, { axis: 'x', at: 1, from: 'start' }), game);
  });

  test('тупик виден сразу, не дожидаясь конца сгибов', () => {
    // 8 → 4 за один сгиб: длина уже как у слова, а уровень решается только за 3
    const halved = playFold(createGame(level), { axis: 'x', at: 4, from: 'start' });
    assert.equal(foldsLeft(halved), 2);
    assert.equal(gameStatus(halved), 'stuck');
    assert.equal(playFold(halved, { axis: 'x', at: 2, from: 'start' }), halved);

    // 8 → 5 → 3: лист стал уже слова
    let narrow = playFold(createGame(level), { axis: 'x', at: 3, from: 'start' });
    assert.equal(gameStatus(narrow), 'playing');
    narrow = playFold(narrow, { axis: 'x', at: 2, from: 'start' });
    assert.equal(currentEntry(narrow).state.w, 3);
    assert.equal(gameStatus(narrow), 'stuck');
  });

  test('отмена и «заново»', () => {
    const start = createGame(level);
    const one = playFold(start, level.solution[0]);
    const two = playFold(one, level.solution[1]);
    assert.deepEqual(undo(two), one);
    assert.deepEqual(restart(two), start);
    assert.equal(undo(start), start);
    assert.equal(restart(start), start);
  });

  test('ходы не меняют прошлые состояния', () => {
    const start = createGame(level);
    const snapshot = structuredClone(start);
    playFold(start, level.solution[0]);
    assert.deepEqual(start, snapshot);
  });
});

describe('originAfterFold: неподвижная часть остаётся на месте', () => {
  test('левая часть направо — лист начинается от линии сгиба', () => {
    // 0 1 | 2 3 4 5: клетка 2 лежала на столе в позиции 2 и там же осталась
    assert.deepEqual(originAfterFold({ x: 0, y: 0 }, createSheet(6), { axis: 'x', at: 2, from: 'start' }), { x: 2, y: 0 });
  });

  test('правая часть налево и свешивается — лист начинается левее', () => {
    // 0 1 | 2 3 4 5 → 5' 4' 3' 2': клетки 0 и 1 остались на месте (позиции 2 и 3 нового листа)
    assert.deepEqual(originAfterFold({ x: 0, y: 0 }, createSheet(6), { axis: 'x', at: 2, from: 'end' }), { x: -2, y: 0 });
  });

  test('горизонтальный сгиб двигает по y', () => {
    assert.deepEqual(originAfterFold({ x: 3, y: 0 }, createSheet(2, 3), { axis: 'y', at: 1, from: 'start' }), { x: 3, y: 1 });
  });

  test('при любых сгибах неподвижные стопки не сдвигаются на столе', () => {
    const rand = mulberry32(5);
    for (let round = 0; round < 100; round++) {
      let state = createSheet(2 + Math.floor(rand() * 8), 1 + Math.floor(rand() * 3));
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

test('bottomColors и topLetters', () => {
  const faces = [
    { color: 1, letter: 'А' }, { color: 2, letter: '' }, // клетка 0: лицо, изнанка
    { color: 3, letter: '' }, { color: 4, letter: 'Б' }, // клетка 1
  ];
  const lvl = { w: 2, h: 1, faces };
  const flat = createSheet(2);
  assert.deepEqual(bottomColors(flat, lvl), [2, 4]);
  assert.deepEqual(topLetters(flat, lvl), ['А', '']);

  // Правая клетка ложится на левую: сверху изнанка клетки 1, снизу по-прежнему изнанка клетки 0.
  const folded = fold(flat, { axis: 'x', at: 1, from: 'end' });
  assert.deepEqual(bottomColors(folded, lvl), [2]);
  assert.deepEqual(topLetters(folded, lvl), ['Б']);
});

test('подсказки ведут к решению из любого решаемого положения', () => {
  let game = createGame(level);
  for (let i = 0; i < level.folds; i++) {
    const move = hintMove(game);
    assert.ok(move, `нет подсказки на шаге ${i}`);
    game = playFold(game, move);
  }
  assert.equal(gameStatus(game), 'solved');
  assert.equal(hintMove(game), null);

  const stuck = playFold(createGame(level), { axis: 'x', at: 4, from: 'start' });
  assert.equal(hintMove(stuck), null);
});
