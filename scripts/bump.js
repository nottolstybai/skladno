// Ставит новую версию сборки, чтобы браузеры не брали старые файлы из кэша.
//   npm run bump  — перед каждым пушем, который меняет сайт.
//
// GitHub Pages разрешает кэшировать файлы на 10 минут. Поэтому к каждому
// файлу добавляется ?v=ВЕРСИЯ (для модулей — через import map в index.html),
// а main.js сверяет свою версию с версией страницы и при расхождении
// один раз перезагружает её.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const version = process.argv[2] ?? new Date().toISOString().replace(/\D/g, '').slice(0, 12);

writeFileSync(
  new URL('src/version.js', root),
  `// Версия сборки: меняется скриптом scripts/bump.js перед каждым деплоем.\nexport const VERSION = '${version}';\n`,
);

const modules = readdirSync(new URL('src/', root))
  .filter((name) => name.endsWith('.js') && name !== 'main.js')
  .sort();
const importMap = JSON.stringify(
  { imports: Object.fromEntries(modules.map((name) => [`./src/${name}`, `./src/${name}?v=${version}`])) },
  null,
  2,
)
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n');

const htmlUrl = new URL('index.html', root);
let html = readFileSync(htmlUrl, 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n${importMap}\n  </script>`);
html = html.replace(/\?v=[\w.-]+/g, `?v=${version}`);
html = html.replace(/data-version="[^"]*"/, `data-version="${version}"`);
writeFileSync(htmlUrl, html);

console.log(`version ${version}`);
