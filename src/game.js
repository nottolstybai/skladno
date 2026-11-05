// Партия: история состояний листа, чтобы отменять сгибы.
//
// Каждая запись — состояние листа и где он лежит на столе (в клетках).
// При сгибе неподвижная часть бумаги остаётся на месте, а перевёрнутая
// ложится поверх неё — так анимация совпадает с тем, что получилось.
//
// Партия неизменяемая: каждый ход возвращает новый объект.

import { createSheet, fold } from './fold.js';
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

// Сгиб. Если сгибать уже нельзя — возвращает ту же партию.
export function playFold(game, move) {
  if (gameStatus(game) !== 'playing') return game;
  const { state, origin } = currentEntry(game);
  const entry = { state: fold(state, move), origin: originAfterFold(origin, state, move) };
  return { ...game, history: [...game.history, entry] };
}

export function undo(game) {
  return game.history.length > 1 ? { ...game, history: game.history.slice(0, -1) } : game;
}

export function restart(game) {
  return game.history.length > 1 ? { ...game, history: game.history.slice(0, 1) } : game;
}
