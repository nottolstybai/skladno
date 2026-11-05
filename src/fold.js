// Модель сгибания листа бумаги.
//
// Лист — сетка w×h позиций. В каждой позиции лежит стопка слоёв (снизу вверх).
// Слой — исходная клетка развёрнутого листа и сторона, которой она смотрит вверх:
//   { cell: номер клетки (y * w + x в развёрнутом листе), flipped: true — вверху изнанка }
//
// Полоска — это просто лист высотой 1.
//
// Сгиб задаётся линией и тем, какая часть переворачивается:
//   { axis: 'x', at: 2, from: 'start' } — вертикальная линия между столбцами 1 и 2,
//                                         левая часть ложится на правую;
//   { axis: 'y', at: 1, from: 'end' }   — горизонтальная линия между строками 0 и 1,
//                                         нижняя часть ложится на верхнюю.
// Переворачиваемая часть зеркалится относительно линии сгиба: её стопки
// переворачиваются (верхний слой становится нижним) и ложатся сверху.
// Если она длиннее неподвижной, лишнее просто свешивается дальше.

export function createSheet(w, h = 1) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new RangeError(`bad sheet size ${w}×${h}`);
  }
  const stacks = [];
  for (let cell = 0; cell < w * h; cell++) stacks.push([{ cell, flipped: false }]);
  return { w, h, stacks };
}

export function fold(state, move) {
  const { axis, at, from } = move;
  if (axis !== 'x' && axis !== 'y') throw new RangeError(`bad axis ${axis}`);
  if (from !== 'start' && from !== 'end') throw new RangeError(`bad side ${from}`);
  const size = axis === 'x' ? state.w : state.h;
  if (!Number.isInteger(at) || at < 1 || at >= size) {
    throw new RangeError(`no crease at ${at} on axis ${axis} of size ${size}`);
  }

  const newSize = Math.max(at, size - at);
  // При from === 'end' линия сгиба становится правым (нижним) краем,
  // поэтому всё сдвигается, если перевёрнутая часть свешивается.
  const offset = from === 'start' ? 0 : newSize - at;
  const isMoving = (c) => (from === 'start' ? c < at : c >= at);
  const mapCoord = (c) => {
    if (from === 'start') return isMoving(c) ? at - 1 - c : c - at;
    return (isMoving(c) ? 2 * at - 1 - c : c) + offset;
  };

  const w = axis === 'x' ? newSize : state.w;
  const h = axis === 'y' ? newSize : state.h;
  const stacks = Array.from({ length: w * h }, () => []);

  // Сначала раскладываем неподвижную часть, потом кладём сверху перевёрнутую.
  for (const movingPass of [false, true]) {
    for (let y = 0; y < state.h; y++) {
      for (let x = 0; x < state.w; x++) {
        if (isMoving(axis === 'x' ? x : y) !== movingPass) continue;
        const nx = axis === 'x' ? mapCoord(x) : x;
        const ny = axis === 'y' ? mapCoord(y) : y;
        const src = state.stacks[y * state.w + x];
        const dst = stacks[ny * w + nx];
        if (!movingPass) {
          for (const layer of src) dst.push(layer);
        } else {
          for (let i = src.length - 1; i >= 0; i--) {
            dst.push({ cell: src[i].cell, flipped: !src[i].flipped });
          }
        }
      }
    }
  }
  return { w, h, stacks };
}

export function applyMoves(state, moves) {
  return moves.reduce((s, move) => fold(s, move), state);
}

export function possibleMoves(state) {
  const moves = [];
  for (const [axis, size] of [['x', state.w], ['y', state.h]]) {
    for (let at = 1; at < size; at++) {
      for (const from of ['start', 'end']) moves.push({ axis, at, from });
    }
  }
  return moves;
}

// Сколько сгибов минимум нужно, чтобы длина size стала не больше target:
// каждый сгиб оставляет не меньше половины, то есть ceil(size / 2).
export function minFolds(size, target) {
  let folds = 0;
  for (let s = size; s > target; s = Math.ceil(s / 2)) folds++;
  return folds;
}

export function topLayers(state) {
  return state.stacks.map((stack) => stack[stack.length - 1]);
}

// Номер грани: у каждой клетки две грани — лицо (2·cell) и изнанка (2·cell + 1).
export function faceId(layer) {
  return layer.cell * 2 + (layer.flipped ? 1 : 0);
}

// Строковый ключ состояния — чтобы решатель не перебирал одно и то же дважды.
export function stateKey(state) {
  return `${state.w}x${state.h}:` + state.stacks.map((s) => s.map(faceId).join(',')).join('|');
}
