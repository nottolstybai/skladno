import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  addDays,
  collectedWords,
  currentStreak,
  emptyStats,
  formatDuration,
  parseStats,
  plural,
  recordSolve,
  shareText,
} from '../src/progress.js';

test('addDays через границы месяцев и лет', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2026-11-05', 0), '2026-11-05');
});

describe('серия', () => {
  const result = { folds: 3, hints: 0, ms: 60_000 };

  test('дни подряд увеличивают серию, пропуск сбрасывает', () => {
    let stats = emptyStats();
    stats = recordSolve(stats, '2026-11-05', result);
    stats = recordSolve(stats, '2026-11-06', result);
    stats = recordSolve(stats, '2026-11-07', result);
    assert.equal(stats.streak, 3);
    assert.equal(stats.best, 3);
    stats = recordSolve(stats, '2026-11-09', result);
    assert.equal(stats.streak, 1);
    assert.equal(stats.best, 3);
    assert.equal(stats.solved, 4);
  });

  test('повторное решение того же дня не считается', () => {
    const once = recordSolve(emptyStats(), '2026-11-05', result);
    assert.equal(recordSolve(once, '2026-11-05', { ...result, hints: 5 }), once);
  });

  test('серия на сегодня гаснет, если вчера не решено', () => {
    const stats = recordSolve(recordSolve(emptyStats(), '2026-11-05', result), '2026-11-06', result);
    assert.equal(currentStreak(stats, '2026-11-06'), 2);
    assert.equal(currentStreak(stats, '2026-11-07'), 2); // сегодня ещё можно продолжить
    assert.equal(currentStreak(stats, '2026-11-08'), 0);
  });
});

test('parseStats отбрасывает мусор', () => {
  assert.deepEqual(parseStats(null), emptyStats());
  assert.deepEqual(parseStats({ solved: 'x' }), emptyStats());
  assert.deepEqual(parseStats('строка'), emptyStats());
  const good = recordSolve(emptyStats(), '2026-11-05', { folds: 2, hints: 0, ms: 1 });
  assert.equal(parseStats(good), good);
});

test('plural', () => {
  const forms = ['сгиб', 'сгиба', 'сгибов'];
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25].map((n) => plural(n, forms)), [
    'сгиб', 'сгиба', 'сгибов', 'сгибов', 'сгибов', 'сгиб', 'сгиба', 'сгибов',
  ]);
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65_000), '1:05');
  assert.equal(formatDuration(3_725_000), '1:02:05');
});

test('shareText без слова, с серией и ссылкой', () => {
  const text = shareText({ dateLabel: '5 ноября', target: [1, 2, 4], folds: 3, hints: 0, undos: 0, streak: 4, url: 'https://x' });
  assert.equal(text, 'Складно · 5 ноября\n🟧🟦🟨\n3 сгиба · без подсказок · с первой попытки\n🔥 серия: 4\nhttps://x');
  const short = shareText({ dateLabel: '6 ноября', target: [0], folds: 1, hints: 2, undos: 3, streak: 1, url: '' });
  assert.equal(short, 'Складно · 6 ноября\n⬜\n1 сгиб · подсказок: 2 · отмен: 3');
});

test('collectedWords — слова по датам, старые записи без слова пропускаются', () => {
  let stats = emptyStats();
  stats = recordSolve(stats, '2026-11-06', { word: 'ПЛЕД', hints: 0, undos: 0, ms: 1 });
  stats = recordSolve(stats, '2026-11-05', { word: 'ЗВЕЗДА', hints: 0, undos: 0, ms: 1 });
  stats = recordSolve(stats, '2026-11-07', { folds: 3, hints: 0, ms: 1 });
  assert.deepEqual(collectedWords(stats), [
    { date: '2026-11-05', word: 'ЗВЕЗДА' },
    { date: '2026-11-06', word: 'ПЛЕД' },
  ]);
});
