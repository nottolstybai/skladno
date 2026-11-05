// Обучение: четыре мини-уровня, каждый учит одной вещи.
//   1. Сгиб переворачивает часть листа — сверху оказывается её оборот.
//   2. Сгибать можно и сверху вниз — кусочки с оборота ложатся ровно.
//   3. Лист можно перевернуть: картинка бывает на обороте.
//   4. Несколько сгибов подряд: бумага ложится стопкой.
//
// Первые три уровня собраны вручную: картинку печатаем ровно туда,
// куда её приносит задуманное складывание (scripted).

import { applyMoves, createSheet } from './fold.js';
import { generateLevel } from './generator.js';
import { PAPERS } from './picture.js';
import { mulberry32 } from './rng.js';
import { topCodes } from './solver.js';

// Уровень, который решается ровно действиями actions. extra — обманки [грань, кусочек, rot].
export function scripted(w, h, actions, extra = []) {
  const state = applyMoves(createSheet(w, h), actions);
  const faces = new Array(w * h * 2).fill(null);
  topCodes(state).forEach((code, p) => {
    faces[code >> 1] = { piece: p, rot: code & 1 };
  });
  for (const [face, piece, rot] of extra) faces[face] = { piece, rot };
  const folds = actions.filter((action) => !action.flip).length;
  return { w, h, targetW: state.w, targetH: state.h, folds, faces, solution: actions };
}

const paper = PAPERS[0];

export const TUTORIAL = [
  {
    // 3×2: две правые клетки уже на месте, две левые — на обороте левого столбца.
    level: scripted(3, 2, [{ axis: 'x', at: 1, from: 'start' }]),
    picture: { seed: 11, scene: 'fuji' },
    text: {
      start: 'Вторая половина картинки — на обороте левого края. Потяни левый край вправо.',
      stuck: 'Не то. Отмени и загни левый край.',
      solved: 'Сгиб переворачивает бумагу — сверху её оборот.',
    },
  },
  {
    // 2×3: нижний ряд загибается вверх.
    level: scripted(2, 3, [{ axis: 'y', at: 2, from: 'end' }]),
    picture: { seed: 12, scene: 'sakura' },
    text: {
      start: 'Сгибать можно и снизу вверх. Потяни нижний край вверх.',
      stuck: 'Не то. Отмени и загни нижний край.',
      solved: 'Кусочки с оборота после верного сгиба ложатся ровно.',
    },
  },
  {
    // 2×2: вся картинка на обороте.
    level: scripted(2, 2, [{ flip: true }]),
    picture: { seed: 13, scene: 'torii' },
    text: {
      start: 'Картинка на обороте. Нажми «Перевернуть».',
      stuck: 'Нажми «Перевернуть».',
      solved: 'Переворот — не сгиб: переворачивай сколько угодно.',
    },
  },
  {
    level: generateLevel(mulberry32(20261106), {
      w: 4, h: 4, targetW: 2, targetH: 2, folds: 2, decoys: 2, flips: 0,
    }),
    picture: { seed: 14, scene: 'moon' },
    text: {
      start: 'Теперь сам: 2 сгиба. Одинаковые кусочки — обманки, подходит только один.',
      stuck: 'Не складывается — отмени сгиб или возьми подсказку.',
      solved: 'Готово! Дальше — картинка дня.',
    },
  },
].map((step) => ({ ...step, level: { ...step.level, paper, picture: step.picture, word: '', note: '' } }));
