// Прогресс и статистика. Здесь только чистые функции;
// читает и пишет localStorage интерфейс (main.js).
//
// stats = {
//   solved,      — сколько дней решено всего
//   streak,      — серия на момент последнего решённого дня
//   best,        — лучшая серия
//   lastSolved,  — 'YYYY-MM-DD' последнего решённого дня или null
//   days,        — { 'YYYY-MM-DD': { word, hints, undos, ms } }
// }

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function emptyStats() {
  return { solved: 0, streak: 0, best: 0, lastSolved: null, days: {} };
}

// Данные из localStorage могут быть битыми или старыми — проверяем форму.
export function parseStats(raw) {
  const ok =
    raw &&
    typeof raw === 'object' &&
    Number.isInteger(raw.solved) &&
    Number.isInteger(raw.streak) &&
    Number.isInteger(raw.best) &&
    (raw.lastSolved === null || typeof raw.lastSolved === 'string') &&
    raw.days &&
    typeof raw.days === 'object';
  return ok ? raw : emptyStats();
}

// Засчитать решённый день. Повторное решение того же дня ничего не меняет.
export function recordSolve(stats, key, result) {
  if (stats.days[key]) return stats;
  const streak = stats.lastSolved === addDays(key, -1) ? stats.streak + 1 : 1;
  return {
    solved: stats.solved + 1,
    streak,
    best: Math.max(stats.best, streak),
    lastSolved: key,
    days: { ...stats.days, [key]: result },
  };
}

// Серия на сегодня: если ни сегодня, ни вчера не решено — серия прервалась.
export function currentStreak(stats, todayKey) {
  if (stats.lastSolved === todayKey || stats.lastSolved === addDays(todayKey, -1)) return stats.streak;
  return 0;
}

export function plural(n, [one, few, many]) {
  if (n % 10 === 1 && n % 100 !== 11) return one;
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return few;
  return many;
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const EMOJI = ['⬜', '🟧', '🟦', '🟩', '🟨', '🟪'];

// Текст «поделиться». Слово не пишем — чтобы не испортить сюрприз другим.
export function shareText({ dateLabel, target, folds, hints, undos, streak, url }) {
  const lines = [
    `Складно · ${dateLabel}`,
    target.map((color) => EMOJI[color]).join(''),
    [
      `${folds} ${plural(folds, ['сгиб', 'сгиба', 'сгибов'])}`,
      hints === 0 ? 'без подсказок' : `подсказок: ${hints}`,
      undos === 0 ? 'с первой попытки' : `отмен: ${undos}`,
    ].join(' · '),
  ];
  if (streak >= 2) lines.push(`🔥 серия: ${streak}`);
  if (url) lines.push(url);
  return lines.join('\n');
}

// Собранные слова дня — по порядку дат.
export function collectedWords(stats) {
  return Object.entries(stats.days)
    .filter(([, day]) => day && typeof day.word === 'string')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, day]) => ({ date, word: day.word }));
}
