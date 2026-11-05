// Показывает уровень дня в терминале — удобно проверить генератор глазами.
//   npm run preview               — сегодня
//   npm run preview -- 2026-11-08 — конкретный день
//   npm run preview -- week       — неделя начиная с сегодня

import { dailyLevel, dateKey, difficultyFor } from '../src/daily.js';
import { applyMoves, createSheet } from '../src/fold.js';
import { revealedLetters, visibleColors } from '../src/level.js';
import { WORDS } from '../src/words.js';

const PALETTE = ['⬜', '🟥', '🟦', '🟩', '🟨', '🟪'];
const paint = (colors) => colors.map((c) => PALETTE[c]).join('');

function describeMove({ at, from }) {
  return from === 'start'
    ? `сгиб после ${at}-й клетки: левую часть направо`
    : `сгиб после ${at}-й клетки: правую часть налево`;
}

function show(date) {
  const level = dailyLevel(date, WORDS);
  const front = level.faces.filter((_, i) => i % 2 === 0).map((f) => f.color);
  const back = level.faces.filter((_, i) => i % 2 === 1).map((f) => f.color);

  console.log(`\n${dateKey(date)} (${difficultyFor(date).name}) — слово «${level.word}», сгибов: ${level.folds}`);
  console.log(`  лицо:     ${paint(front)}`);
  console.log(`  изнанка:  ${paint(back)}   (номера клеток с 1, слева направо)`);
  console.log(`  цель:     ${paint(level.target)}`);
  console.log('  решение:');
  let state = createSheet(level.w);
  for (const move of level.solution) {
    state = applyMoves(state, [move]);
    console.log(`    ${describeMove(move).padEnd(44)} → ${paint(visibleColors(state, level))}`);
  }
  console.log(`  проступает: ${revealedLetters(state, level)} (слоёв в стопках: ${state.stacks.map((s) => s.length).join(' ')})`);
}

const arg = process.argv[2];
if (arg === 'week') {
  const today = new Date();
  for (let i = 0; i < 7; i++) show(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i, 12));
} else {
  show(arg ? new Date(`${arg}T12:00`) : new Date());
}
