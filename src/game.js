// Партия: история состояний листа, чтобы отменять сгибы.
//
// Каждая запись — состояние листа и где он лежит на столе (в клетках).
// При сгибе неподвижная часть бумаги остаётся на месте, а перевёрнутая
// ложится поверх неё — так анимация совпадает с тем, что получилось.
//
// Партия неизменяемая: каждый ход возвращает новый объект.

import { createSheet, fold, possibleMoves, stateKey } from './fold.js';
import { isSolved } from './level.js';
import { canReachSize } from './solver.js';

export function createGame(level) {
  return { level, history: [{ state: createSheet(level.w, level.h), origin: { x: 0, y: 0 } }] };
}

export function currentEntry(game) {
  return game.history[game.history.length - 1];
}

export function foldsUsed(game) {
  return game.history.length - 1;
}

export function foldsLeft(game) {
  return game.level.folds - foldsUsed(game);
}

// 'solved'  — узор совпал;
// 'stuck'   — этим путём узор уже не получить (сгибы кончились, лист слишком
//             узкий или уже нужного размера, но узор не тот);
// 'playing' — можно сгибать дальше.
export function gameStatus(game) {
  const { state } = currentEntry(game);
  if (isSolved(state, game.level)) return 'solved';
  const { targetW, targetH } = game.level;
  const atTargetSize = state.w === targetW && state.h === targetH;
  if (atTargetSize || !canReachSize(state, game.level, foldsLeft(game))) return 'stuck';
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
  const entry = { state: fold(state, move), origin: originAfterFold(origin, state, move), move };
  return { ...game, history: [...game.history, entry] };
}

// Сгибы, сделанные в партии, по порядку — чтобы сохранить и восстановить её.
export function movesOf(game) {
  return game.history.slice(1).map((entry) => entry.move);
}

export function undo(game) {
  return game.history.length > 1 ? { ...game, history: game.history.slice(0, -1) } : game;
}

export function restart(game) {
  return game.history.length > 1 ? { ...game, history: game.history.slice(0, 1) } : game;
}

// Подсказка: первый сгиб кратчайшего пути от текущего положения к решению.
// null — отсюда уже не решить (или уровень решён).
export function hintMove(game) {
  if (gameStatus(game) !== 'playing') return null;
  const left = foldsLeft(game);
  const { state } = currentEntry(game);
  const seen = new Set([stateKey(state)]);
  let frontier = [{ state, first: null }];
  for (let depth = 0; depth < left && frontier.length > 0; depth++) {
    const next = [];
    for (const node of frontier) {
      for (const move of possibleMoves(node.state)) {
        const folded = fold(node.state, move);
        const first = node.first ?? move;
        if (isSolved(folded, game.level)) return first;
        const key = stateKey(folded);
        if (seen.has(key) || !canReachSize(folded, game.level, left - depth - 1)) continue;
        seen.add(key);
        next.push({ state: folded, first });
      }
    }
    frontier = next;
  }
  return null;
}
