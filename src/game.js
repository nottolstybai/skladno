// Партия: история состояний листа, чтобы отменять действия.
//
// Каждая запись — состояние листа, где он лежит на столе (в клетках) и действие,
// которое к нему привело: сгиб { axis, at, from } или переворот листа { flip: true }.
// При сгибе неподвижная часть бумаги остаётся на месте, а перевёрнутая
// ложится поверх неё — так анимация совпадает с тем, что получилось.
// Переворот листа бесплатный и сгибом не считается.
//
// Партия неизменяемая: каждый ход возвращает новый объект.

import { createSheet, flipSheet, fold, physicalKey, possibleMoves } from './fold.js';
import { isSolved } from './level.js';
import { canReachSize } from './solver.js';

const FLIP = Object.freeze({ flip: true });

export function createGame(level) {
  return { level, history: [{ state: createSheet(level.w, level.h), origin: { x: 0, y: 0 } }] };
}

export function currentEntry(game) {
  return game.history[game.history.length - 1];
}

export function foldsUsed(game) {
  return game.history.filter((entry) => entry.action && !entry.action.flip).length;
}

export function foldsLeft(game) {
  return game.level.folds - foldsUsed(game);
}

const atTargetSize = (state, level) => state.w === level.targetW && state.h === level.targetH;

// 'solved'  — картинка собрана;
// 'flip'    — картинка собрана, но снизу: осталось перевернуть лист;
// 'stuck'   — этим путём картинку уже не собрать (сгибы кончились, лист слишком
//             узкий или уже нужного размера, но картинка не та);
// 'playing' — можно сгибать дальше.
export function gameStatus(game) {
  const { state } = currentEntry(game);
  const { level } = game;
  if (isSolved(state, level)) return 'solved';
  if (atTargetSize(state, level)) return isSolved(flipSheet(state), level) ? 'flip' : 'stuck';
  if (!canReachSize(state, level, foldsLeft(game))) return 'stuck';
  return 'playing';
}

// Куда сдвинется начало листа после сгиба, если неподвижная часть не двигается.
export function originAfterFold(origin, state, move) {
  const size = move.axis === 'x' ? state.w : state.h;
  const newSize = Math.max(move.at, size - move.at);
  const shift = move.from === 'start' ? move.at : move.at - newSize;
  return move.axis === 'x' ? { x: origin.x + shift, y: origin.y } : { x: origin.x, y: origin.y + shift };
}

// Куда на новом листе легла перевёрнутая часть: номера позиций по оси сгиба.
export function landedPositions(state, move) {
  const size = move.axis === 'x' ? state.w : state.h;
  const newSize = Math.max(move.at, size - move.at);
  const count = move.from === 'start' ? move.at : size - move.at;
  const first = move.from === 'start' ? 0 : newSize - count;
  return Array.from({ length: count }, (_, i) => first + i);
}

// Сгиб. Если сгибать уже нельзя — возвращает ту же партию.
export function playFold(game, move) {
  if (gameStatus(game) !== 'playing') return game;
  const { state, origin } = currentEntry(game);
  const entry = { state: fold(state, move), origin: originAfterFold(origin, state, move), action: move };
  return { ...game, history: [...game.history, entry] };
}

// Переворот листа: лист остаётся на том же месте стола.
export function playFlip(game) {
  if (gameStatus(game) === 'solved') return game;
  const { state, origin } = currentEntry(game);
  return { ...game, history: [...game.history, { state: flipSheet(state), origin, action: FLIP }] };
}

export function play(game, action) {
  return action.flip ? playFlip(game) : playFold(game, action);
}

// Действия партии по порядку — чтобы сохранить и восстановить её.
export function actionsOf(game) {
  return game.history.slice(1).map((entry) => entry.action);
}

export function replay(level, actions) {
  return actions.reduce(play, createGame(level));
}

export function undo(game) {
  return game.history.length > 1 ? { ...game, history: game.history.slice(0, -1) } : game;
}

export function restart(game) {
  return game.history.length > 1 ? { ...game, history: game.history.slice(0, 1) } : game;
}

// Подсказка: первое действие кратчайшего пути от текущего положения к решению
// (сгиб или переворот листа). null — отсюда уже не решить (или уровень решён).
export function hintAction(game) {
  const status = gameStatus(game);
  if (status === 'flip') return FLIP;
  if (status !== 'playing') return null;
  const { level } = game;
  const left = foldsLeft(game);
  const { state } = currentEntry(game);
  const seen = new Set([physicalKey(state)]);
  let frontier = [{ state, first: null }];
  for (let depth = 0; depth < left && frontier.length > 0; depth++) {
    const next = [];
    for (const node of frontier) {
      for (const [side, viaFlip] of [[node.state, false], [flipSheet(node.state), true]]) {
        for (const move of possibleMoves(side)) {
          const folded = fold(side, move);
          const first = node.first ?? (viaFlip ? FLIP : move);
          if (isSolved(folded, level) || (atTargetSize(folded, level) && isSolved(flipSheet(folded), level))) {
            return first;
          }
          const key = physicalKey(folded);
          if (seen.has(key) || !canReachSize(folded, level, left - depth - 1)) continue;
          seen.add(key);
          next.push({ state: folded, first });
        }
      }
    }
    frontier = next;
  }
  return null;
}
