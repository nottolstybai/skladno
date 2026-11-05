import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  dailyLevel,
  dateKey,
  dayNumber,
  DIFFICULTY,
  difficultyFor,
  entryFor,
  generateWithFallback,
  stripLength,
  wordFor,
} from '../src/daily.js';
import { applyMoves, createSheet } from '../src/fold.js';
import { revealedLetters } from '../src/level.js';
import { mulberry32, hashString } from '../src/rng.js';
import { WORDS } from '../src/words.js';

const day = (y, m, d) => new Date(y, m - 1, d, 12);

test('rng детерминирован', () => {
  const a = mulberry32(hashString('2026-11-05'));
  const b = mulberry32(hashString('2026-11-05'));
  const c = mulberry32(hashString('2026-11-06'));
  const seqA = Array.from({ length: 5 }, a);
  assert.deepEqual(seqA, Array.from({ length: 5 }, b));
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, c));
  assert.ok(seqA.every((x) => x >= 0 && x < 1));
});

test('dateKey по местной дате с нулями', () => {
  assert.equal(dateKey(day(2026, 11, 5)), '2026-11-05');
  assert.equal(dateKey(day(2027, 1, 9)), '2027-01-09');
});

test('dayNumber считает от 1 ноября 2026', () => {
  assert.equal(dayNumber(day(2026, 11, 1)), 0);
  assert.equal(dayNumber(new Date(2026, 10, 1, 23, 59)), 0);
  assert.equal(dayNumber(day(2026, 11, 5)), 4);
  assert.equal(dayNumber(day(2027, 11, 1)), 365);
  assert.equal(dayNumber(day(2026, 10, 31)), -1);
  assert.equal(dayNumber(day(2027, 3, 29)) - dayNumber(day(2027, 3, 28)), 1);
});

test('сложность по дням недели осуществима', () => {
  assert.equal(DIFFICULTY.length, 7);
  for (const d of DIFFICULTY) {
    // каждый сгиб убирает хотя бы клетку, а слова — от 3 букв
    assert.ok(d.folds <= stripLength('КОТ', d) - 3, `${d.name}: сгибов больше, чем лишних клеток`);
  }
  assert.equal(stripLength('ЛУНА', { double: true }), 8);
  assert.equal(stripLength('ЛУНА', { extra: 3 }), 7);
  assert.equal(difficultyFor(day(2026, 11, 2)).name, 'понедельник');
  assert.equal(difficultyFor(day(2026, 11, 8)).name, 'воскресенье');
});

test('wordFor идёт по списку по кругу', () => {
  const words = ['РАЗ', 'ДВА', 'ТРИ'];
  assert.equal(wordFor(day(2026, 11, 1), words), 'РАЗ');
  assert.equal(wordFor(day(2026, 11, 3), words), 'ТРИ');
  assert.equal(wordFor(day(2026, 11, 4), words), 'РАЗ');
  assert.equal(wordFor(day(2026, 10, 31), words), 'ТРИ');
});

test('все слова из списка подходят', () => {
  assert.ok(WORDS.length > 0);
  for (const entry of WORDS) {
    const word = typeof entry === 'string' ? entry : entry.word;
    assert.match(word, /^[А-ЯЁ]{3,6}$/u);
  }
});

test('слово может быть с запиской', () => {
  const words = ['РАЗ', { word: 'ДВА', note: 'помнишь?' }];
  assert.deepEqual(entryFor(day(2026, 11, 1), words), { word: 'РАЗ', note: '' });
  assert.deepEqual(entryFor(day(2026, 11, 2), words), { word: 'ДВА', note: 'помнишь?' });
  assert.equal(wordFor(day(2026, 11, 2), words), 'ДВА');
});

test('generateWithFallback берёт первую сложность, которая получилась', () => {
  const impossible = { extra: 1, folds: 3, colors: 3, twoSided: true }; // 3 сгиба не уберут всего 1 клетку
  const easy = { extra: 2, folds: 2, colors: 3, twoSided: true };
  const level = generateWithFallback(mulberry32(3), 'ЛУНА', [impossible, easy]);
  assert.equal(level.folds, 2);
  assert.throws(() => generateWithFallback(mulberry32(3), 'ЛУНА', [impossible]), RangeError);
});

describe('dailyLevel', () => {
  test('один день — один уровень', () => {
    assert.deepEqual(dailyLevel(day(2026, 11, 5), WORDS), dailyLevel(new Date(2026, 10, 5, 8), WORDS));
  });

  test('год уровней генерируется, и каждый открывает слово дня', () => {
    for (const words of [WORDS, ['КОТ'], ['УЛЫБКА']]) {
      for (let i = 0; i < 365; i++) {
        const date = new Date(2026, 10, 1 + i, 12);
        const level = dailyLevel(date, words);
        const folded = applyMoves(createSheet(level.w), level.solution);
        assert.equal(revealedLetters(folded, level), wordFor(date, words));
        assert.equal(level.folds, difficultyFor(date).folds, `${dateKey(date)}: сработала подстраховка`);
      }
    }
  });
});
