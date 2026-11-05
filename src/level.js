// Уровень — что напечатано на бумаге и что нужно собрать.
//
// {
//   w, h,               — размер развёрнутого листа
//   targetW, targetH,   — размер картинки (и сложенного листа в ответе)
//   folds,              — сколько сгибов даётся; меньшим числом не решить
//   faces,              — по номеру грани (см. faceId в fold.js): null — чистая бумага,
//                         { piece, rot } — кусочек картинки piece (клетка piece % targetW,
//                         ⌊piece / targetW⌋), rot = 1 — напечатан вверх ногами
//   paper,              — { front, back } — цвета лица и изнанки
//   picture,            — { seed, scene } — картинка рисуется по seed (picture.js)
//   solution,           — одна из последовательностей действий, которая решает уровень
//   word, note,         — слово дня и записка к нему
// }
//
// Кусочек на верхнем слое виден повёрнутым, если rot XOR turned (turned — у слоя).

import { faceId, topLayers } from './fold.js';

// Что видно сверху в каждой позиции: null или { piece, rot }.
export function visiblePieces(state, level) {
  return topLayers(state).map((layer) => {
    const face = level.faces[faceId(layer)];
    return face ? { piece: face.piece, rot: face.rot ^ (layer.turned ? 1 : 0) } : null;
  });
}

export function isSolved(state, level) {
  if (state.w !== level.targetW || state.h !== level.targetH) return false;
  return visiblePieces(state, level).every((v, p) => v !== null && v.piece === p && v.rot === 0);
}
