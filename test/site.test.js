// Проверки сайта без браузера: обучение решается, версии файлов согласованы.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { applyMoves, createSheet } from '../src/fold.js';
import { revealedLetters } from '../src/level.js';
import { solve } from '../src/solver.js';
import { TUTORIAL } from '../src/tutorial.js';
import { VERSION } from '../src/version.js';
import { PRACTICE_WORDS } from '../src/words.js';

test('обучение: каждый шаг решается ровно за свои сгибы, единственным способом', () => {
  assert.equal(TUTORIAL.length, 3);
  for (const [i, step] of TUTORIAL.entries()) {
    const { level } = step;
    const check = solve(level);
    assert.equal(check.minDepth, level.folds, `шаг ${i + 1}`);
    assert.equal(check.arrangements, 1, `шаг ${i + 1}`);
    if (step.crease !== null) assert.equal(level.solution[0].at, step.crease);
    if (step.side !== null) assert.equal(level.solution[0].from, step.side);
    const folded = applyMoves(createSheet(level.w), level.solution);
    assert.equal(revealedLetters(folded, level), level.word);
    for (const key of ['start', 'selected', 'stuck', 'solved']) assert.ok(step.text[key], `шаг ${i + 1}: ${key}`);
  }
});

test('слова тренировки подходят', () => {
  for (const word of PRACTICE_WORDS) assert.match(word, /^[А-ЯЁ]{3,6}$/u);
});

test('index.html: у всех файлов одна версия, import map покрывает все модули', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, new RegExp(`data-version="${VERSION}"`));
  assert.match(html, new RegExp(`style\\.css\\?v=${VERSION}"`));
  assert.match(html, new RegExp(`src/main\\.js\\?v=${VERSION}"`));
  for (const v of html.matchAll(/\?v=([\w.-]+)/g)) assert.equal(v[1], VERSION, 'забыли npm run bump');

  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
  const modules = readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'main.js');
  for (const name of modules) assert.equal(map[`./src/${name}`], `./src/${name}?v=${VERSION}`, name);
});
