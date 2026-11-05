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
  parseDateKey,
  wordFor,
} from '../src/daily.js';
import { applyMoves, createSheet } from '../src/fold.js';
import { isSolved } from '../src/level.js';
import { PAPERS, SCENE_NAMES } from '../src/picture.js';
import { hashString, mulberry32 } from '../src/rng.js';
import { solve } from '../src/solver.js';
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

test('dateKey и parseDateKey по местной дате', () => {
  assert.equal(dateKey(day(2026, 11, 5)), '2026-11-05');
  assert.equal(dateKey(day(2027, 1, 9)), '2027-01-09');
  assert.equal(dateKey(parseDateKey('2027-03-28')), '2027-03-28');
  assert.equal(parseDateKey('2027-02-30'), null);
  assert.equal(parseDateKey('вчера'), null);
  assert.equal(parseDateKey(null), null);
});

test('dayNumber считает от 1 ноября 2026', () => {
  assert.equal(dayNumber(day(2026, 11, 1)), 0);
  assert.equal(dayNumber(new Date(2026, 10, 1, 23, 59)), 0);
  assert.equal(dayNumber(day(2026, 11, 5)), 4);
  assert.equal(dayNumber(day(2027, 11, 1)), 365);
  assert.equal(dayNumber(day(2026, 10, 31)), -1);
  assert.equal(dayNumber(day(2027, 3, 29)) - dayNumber(day(2027, 3, 28)), 1);
});

test('сложность по дням недели', () => {
  assert.equal(DIFFICULTY.length, 7);
  assert.equal(difficultyFor(day(2026, 11, 2)).name, 'понедельник');
  assert.equal(difficultyFor(day(2026, 11, 8)).name, 'воскресенье');
  for (const d of DIFFICULTY) assert.ok(d.targetW <= d.w && d.targetH <= d.h, d.name);
});

describe('слова', () => {
  test('идут по списку по кругу', () => {
    const words = ['РАЗ', 'ДВА', 'ТРИ'];
    assert.equal(wordFor(day(2026, 11, 1), words), 'РАЗ');
    assert.equal(wordFor(day(2026, 11, 3), words), 'ТРИ');
    assert.equal(wordFor(day(2026, 11, 4), words), 'РАЗ');
    assert.equal(wordFor(day(2026, 10, 31), words), 'ТРИ');
  });

  test('слово может быть с запиской', () => {
    const words = ['РАЗ', { word: 'ДВА', note: 'помнишь?' }];
    assert.deepEqual(entryFor(day(2026, 11, 1), words), { word: 'РАЗ', note: '', date: null });
    assert.deepEqual(entryFor(day(2026, 11, 2), words), { word: 'ДВА', note: 'помнишь?', date: null });
  });

  test('слово с датой выпадает ровно в свой день и не сбивает круг', () => {
    const words = ['РАЗ', { word: 'ТОРТ', note: 'С днём рождения!', date: '2026-11-02' }, 'ДВА'];
    assert.equal(wordFor(day(2026, 11, 1), words), 'РАЗ');
    assert.deepEqual(entryFor(day(2026, 11, 2), words), { word: 'ТОРТ', note: 'С днём рождения!', date: '2026-11-02' });
    // круг считается по номеру дня, как будто особого слова нет
    assert.equal(wordFor(day(2026, 11, 3), words), 'РАЗ');
    assert.equal(wordFor(day(2026, 11, 4), words), 'ДВА');
  });

  test('все слова из списка подходят', () => {
    assert.ok(WORDS.length > 0);
    for (const entry of WORDS) {
      const word = typeof entry === 'string' ? entry : entry.word;
      assert.match(word, /^[А-ЯЁ]{2,12}$/u);
      if (typeof entry !== 'string' && entry.date) assert.ok(parseDateKey(entry.date), `дата ${entry.date}`);
    }
  });
});

test('generateWithFallback берёт первую сложность, которая получилась', () => {
  const impossible = { w: 3, h: 3, targetW: 2, targetH: 2, folds: 1 }; // за один сгиб не успеть
  const easy = { w: 3, h: 3, targetW: 2, targetH: 2, folds: 2 };
  assert.equal(generateWithFallback(mulberry32(3), [impossible, easy]).folds, 2);
  assert.throws(() => generateWithFallback(mulberry32(3), [impossible]), RangeError);
});

describe('dailyLevel', () => {
  test('один день — один уровень', () => {
    assert.deepEqual(dailyLevel(day(2026, 11, 5), WORDS), dailyLevel(new Date(2026, 10, 5, 8), WORDS));
  });

  test('слово, записка, бумага и картинка', () => {
    const level = dailyLevel(day(2026, 11, 2), ['раз', { word: 'два', note: 'ура' }]);
    assert.equal(level.word, 'ДВА');
    assert.equal(level.note, 'ура');
    assert.ok(PAPERS.includes(level.paper));
    assert.ok(Number.isInteger(level.picture.seed));
    assert.ok(SCENE_NAMES.includes(level.picture.scene));
    const tomorrow = dailyLevel(day(2026, 11, 3), WORDS);
    assert.notEqual(tomorrow.picture.scene, level.picture.scene, 'сцены меняются каждый день');
  });

  test('полгода уровней: сложность своего дня, решаются ровно и единственным способом', () => {
    for (let i = 0; i < 182; i++) {
      const date = new Date(2026, 10, 1 + i, 12);
      const level = dailyLevel(date, WORDS);
      const d = difficultyFor(date);
      assert.deepEqual([level.w, level.h, level.folds], [d.w, d.h, d.folds], `${dateKey(date)}: сработала подстраховка`);
      assert.equal(isSolved(applyMoves(createSheet(level.w, level.h), level.solution), level), true);
      const check = solve(level);
      assert.equal(check.minDepth, level.folds, dateKey(date));
      assert.equal(check.arrangements, 1, dateKey(date));
    }
  });
});
