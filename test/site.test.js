// Проверки сайта без браузера: обучение решается, версии файлов согласованы.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { applyMoves, createSheet } from '../src/fold.js';
import { isSolved } from '../src/level.js';
import { drawPicture, SCENE_NAMES } from '../src/picture.js';
import { mulberry32 } from '../src/rng.js';
import { solve } from '../src/solver.js';
import { TUTORIAL } from '../src/tutorial.js';
import { VERSION } from '../src/version.js';

test('обучение: каждый шаг решается ровно за свои сгибы, единственным способом', () => {
  assert.equal(TUTORIAL.length, 4);
  for (const [i, step] of TUTORIAL.entries()) {
    const { level } = step;
    const check = solve(level);
    assert.equal(check.minDepth, level.folds, `шаг ${i + 1}`);
    assert.equal(check.arrangements, 1, `шаг ${i + 1}`);
    assert.equal(isSolved(applyMoves(createSheet(level.w, level.h), level.solution), level), true);
    for (const key of ['start', 'stuck', 'solved']) assert.ok(step.text[key], `шаг ${i + 1}: ${key}`);
  }
});

test('картинки: все сцены всех размеров рисуются и не повторяются', () => {
  for (const scene of SCENE_NAMES) {
    for (const [w, h] of [[2, 2], [3, 2], [3, 3]]) {
      const a = drawPicture(mulberry32(1), { w, h, scene });
      assert.equal(a.scene, scene);
      assert.match(a.svg, new RegExp(`^<svg [^>]*viewBox="0 0 ${w * 100} ${h * 100}"`));
      assert.ok(!/NaN|undefined|Infinity/.test(a.svg), `${scene} ${w}×${h}`);
      assert.deepEqual(drawPicture(mulberry32(1), { w, h, scene }), a);
      assert.notEqual(drawPicture(mulberry32(2), { w, h, scene }).svg, a.svg);
    }
  }
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
