// Уровень — что нарисовано на бумаге и что нужно получить.
//
// {
//   w, h,               — размер развёрнутого листа
//   faces,              — [{ color, letter }] по номеру грани (см. faceId в fold.js);
//                         буквы есть только на гранях, которые окажутся сверху в ответе
//   target,             — цвета, которые должны оказаться сверху (построчно)
//   targetW, targetH,   — размер сложенного листа в ответе
//   folds,              — сколько сгибов даётся; меньшим числом не решить
//   word,               — слово дня, проступает сверху, когда узор совпал
//   solution,           — одна из последовательностей сгибов, которая решает уровень
// }

import { faceId, topLayers } from './fold.js';

export function visibleColors(state, level) {
  return topLayers(state).map((layer) => level.faces[faceId(layer)].color);
}

export function isSolved(state, level) {
  if (state.w !== level.targetW || state.h !== level.targetH) return false;
  const colors = visibleColors(state, level);
  return colors.every((color, i) => color === level.target[i]);
}

export function revealedLetters(state, level) {
  return topLayers(state)
    .map((layer) => level.faces[faceId(layer)].letter)
    .join('');
}
