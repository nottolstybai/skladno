// Показывает уровень дня в терминале — удобно проверить генератор глазами.
//   npm run preview               — сегодня
//   npm run preview -- 2026-11-08 — конкретный день
//   npm run preview -- week       — неделя начиная с сегодня
//
// Кусочек картинки — буква (A — левый верхний, дальше по строкам),
// строчная — напечатан вверх ногами; «·» — чистая бумага.

import { dailyLevel, dateKey, difficultyFor, parseDateKey } from '../src/daily.js';
import { pictureTitle, drawPicture } from '../src/picture.js';
import { mulberry32 } from '../src/rng.js';
import { WORDS } from '../src/words.js';

const letter = (face) => {
  if (!face) return '·';
  const ch = String.fromCharCode(65 + face.piece);
  return face.rot ? ch.toLowerCase() : ch;
};

function grid(level, side) {
  const rows = [];
  for (let y = 0; y < level.h; y++) {
    const cells = [];
    for (let x = 0; x < level.w; x++) cells.push(letter(level.faces[(y * level.w + x) * 2 + side]));
    rows.push(cells.join(' '));
  }
  return rows;
}

function describe(action) {
  if (action.flip) return 'перевернуть лист';
  const where = action.axis === 'x' ? `после ${action.at}-го столбца` : `после ${action.at}-й строки`;
  const part = { 'x:start': 'левую часть направо', 'x:end': 'правую часть налево', 'y:start': 'верхнюю часть вниз', 'y:end': 'нижнюю часть вверх' };
  return `линия ${where}: ${part[`${action.axis}:${action.from}`]}`;
}

function show(date) {
  const level = dailyLevel(date, WORDS);
  const pic = drawPicture(mulberry32(level.picture.seed), { w: level.targetW, h: level.targetH, scene: level.picture.scene });
  console.log(`\n${dateKey(date)} (${difficultyFor(date).name}) — «${level.word}», ${pictureTitle(pic)}, бумага ${level.paper.name}`);
  console.log(`  лист ${level.w}×${level.h} → картинка ${level.targetW}×${level.targetH} за ${level.folds} сгиба`);
  const front = grid(level, 0);
  const back = grid(level, 1);
  console.log(`  ${'лицо'.padEnd(level.w * 2 + 2)}оборот (как видно, если перевернуть лист)`);
  for (let y = 0; y < level.h; y++) {
    const mirrored = back[y].split(' ').reverse().join(' ');
    console.log(`  ${front[y].padEnd(level.w * 2 + 2)}${mirrored}`);
  }
  console.log('  решение:');
  for (const action of level.solution) console.log(`    ${describe(action)}`);
}

const arg = process.argv[2];
if (arg === 'week') {
  const today = new Date();
  for (let i = 0; i < 7; i++) show(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i, 12));
} else {
  show(arg ? parseDateKey(arg) : new Date());
}
