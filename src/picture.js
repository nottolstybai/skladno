// Картинка дня — пейзаж в духе японской гравюры: небо с переходом цвета,
// солнце или луна, горы, полосы тумана, вода, птицы, лодка, тории, сакура.
//
// Рисуется целиком по случайному генератору, без файлов: SVG-строка
// размером w×h клеток, 100 единиц на клетку. Кусочек p — клетка (p % w, ⌊p / w⌋).
//
// Композиция всегда несимметрична (солнце с одной стороны, гора с другой),
// а небо сверху тёмное, у горизонта светлое — поэтому кусочки не спутать
// друг с другом и сразу видно, если кусочек лежит вверх ногами.

import { pick } from './rng.js';

export const INK = '#1d1d1d';
export const CREAM = '#f3e7cf';
export const VERMILION = '#c9452b';

// Бумага: лицо цветное, изнанка светлая — как у настоящей бумаги для оригами.
export const PAPERS = [
  { name: 'индиго', front: '#2b4c74', back: '#f1e6d0' },
  { name: 'киноварь', front: '#b5432d', back: '#f3e9d6' },
  { name: 'матча', front: '#667f52', back: '#f2ead8' },
  { name: 'слива', front: '#6b4862', back: '#f3e8d8' },
];

const SKIES = {
  dawn: {
    sky: ['#22406b', '#7f93ad', '#efc9a0', '#f5e6cc'],
    far: '#93a3b8', mid: '#56708f', near: '#2b4c74', water: '#264f78', foam: '#e9dcc0',
    mist: '#f4dcc0', sun: VERMILION,
  },
  day: {
    sky: ['#3d6c97', '#98b6cc', '#e4e1d3', '#f4ecdc'],
    far: '#a9bccb', mid: '#6d8fa8', near: '#3b5f7d', water: '#2e5a80', foam: '#e6edf0',
    mist: '#f3ecdd', sun: VERMILION,
  },
  dusk: {
    sky: ['#4d2638', '#b0473a', '#e7a35d', '#f4e1bf'],
    far: '#a7777a', mid: '#6e4a5c', near: '#3b2d40', water: '#3c3550', foam: '#efc9a0',
    mist: '#f0c9a0', sun: '#f2c879',
  },
  night: {
    sky: ['#0d1729', '#1b3152', '#3a5a82', '#5d7ea3'],
    far: '#33507a', mid: '#22395c', near: '#121f35', water: '#14243d', foam: '#9fb3cc',
    mist: '#2c4569', sun: CREAM,
  },
};

const r1 = (n) => Math.round(n * 10) / 10;
const between = (rand, a, b) => a + (b - a) * rand();

function skyLayer(W, horizon, colors) {
  const stops = colors
    .map((c, i) => `<stop offset="${r1(i / (colors.length - 1))}" stop-color="${c}"/>`)
    .join('');
  return (
    `<linearGradient id="sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${r1(horizon)}">${stops}</linearGradient>` +
    `<rect width="${W}" height="${r1(horizon + 2)}" fill="url(#sky)"/>`
  );
}

function disc(cx, cy, r, color, glow) {
  const halo = glow ? `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r * 1.7)}" fill="${color}" opacity=".16"/>` : '';
  return `${halo}<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${color}"/>`;
}

function stars(rand, W, maxY, count) {
  let out = '';
  for (let i = 0; i < count; i++) {
    out += `<circle cx="${r1(between(rand, 4, W - 4))}" cy="${r1(between(rand, 4, maxY))}" r="${r1(between(rand, 0.7, 1.5))}" fill="${CREAM}" opacity="${r1(between(rand, 0.5, 0.95))}"/>`;
  }
  return out;
}

// Гряда холмов: плавная линия через случайные вершины.
function ridge(rand, W, bottom, baseY, amp, color, steps = 6) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    pts.push([-10 + ((W + 20) * i) / steps, baseY - amp * (0.3 + 0.7 * rand())]);
  }
  let d = `M -10 ${r1(bottom)} L ${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += ` Q ${r1(x)} ${r1(y)} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  d += ` L ${r1(lx)} ${r1(ly)} L ${W + 10} ${r1(bottom)} Z`;
  return `<path d="${d}" fill="${color}"/>`;
}

// Гора со снежной шапкой и тенью на правом склоне.
function fuji(rand, cx, baseY, width, height, color, snow) {
  const peakY = baseY - height;
  const top = width * 0.05;
  const d =
    `M ${r1(cx - width / 2)} ${r1(baseY)} ` +
    `Q ${r1(cx - width * 0.16)} ${r1(baseY - height * 0.6)} ${r1(cx - top)} ${r1(peakY)} ` +
    `L ${r1(cx + top)} ${r1(peakY)} ` +
    `Q ${r1(cx + width * 0.17)} ${r1(baseY - height * 0.58)} ${r1(cx + width / 2)} ${r1(baseY)} Z`;
  const snowY = peakY + height * between(rand, 0.26, 0.34);
  const teeth = 7;
  let s = `M ${r1(cx - width)} ${r1(peakY - 4)} L ${r1(cx + width)} ${r1(peakY - 4)} L ${r1(cx + width)} ${r1(snowY)}`;
  for (let i = teeth; i >= 0; i--) {
    const x = cx - width * 0.32 + (width * 0.64 * i) / teeth;
    const y = snowY + (i % 2 ? height * 0.09 : -height * 0.02) * between(rand, 0.6, 1.2);
    s += ` L ${r1(x)} ${r1(y)}`;
  }
  s += ` L ${r1(cx - width)} ${r1(snowY)} Z`;
  const shade = `M ${r1(cx + top * 0.2)} ${r1(peakY)} L ${r1(cx + width / 2)} ${r1(baseY)} L ${r1(cx + width * 0.08)} ${r1(baseY)} Z`;
  return (
    `<clipPath id="fuji"><path d="${d}"/></clipPath>` +
    `<path d="${d}" fill="${color}"/>` +
    `<g clip-path="url(#fuji)"><path d="${s}" fill="${snow}"/><path d="${shade}" fill="#000" opacity=".14"/></g>`
  );
}

function mist(x, y, width, height, color, opacity = 0.92) {
  return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(width)}" height="${r1(height)}" rx="${r1(height / 2)}" fill="${color}" opacity="${opacity}"/>`;
}

function water(rand, W, H, horizon, color, foam) {
  let out = `<rect y="${r1(horizon)}" width="${W}" height="${r1(H - horizon)}" fill="${color}"/>`;
  const period = 14;
  const rows = Math.floor((H - horizon - 8) / 11);
  for (let row = 0; row < rows; row++) {
    const y = horizon + 9 + row * 11;
    const start = -period * (row % 2 ? 0.5 : 1) - period * rand() * 0.3;
    let d = `M ${r1(start)} ${r1(y)}`;
    for (let x = start; x < W + period; x += period) d += ` q ${period / 2} -4.5 ${period} 0`;
    const opacity = Math.max(0.22, 0.7 - row * 0.07);
    out += `<path d="${d}" fill="none" stroke="${foam}" stroke-width="1.7" stroke-linecap="round" opacity="${r1(opacity)}"/>`;
  }
  return out;
}

function reflection(cx, horizon, r, color) {
  let out = '';
  for (let k = 0; k < 5; k++) {
    const w = r * 1.5 * (1 - k * 0.17);
    out += `<rect x="${r1(cx - w / 2)}" y="${r1(horizon + 5 + k * 8)}" width="${r1(w)}" height="2.6" rx="1.3" fill="${color}" opacity="${r1(0.75 - k * 0.1)}"/>`;
  }
  return out;
}

// Стайка птиц: SVG и точная рамка вокруг всех птиц.
function flock(rand, x, y, count, color = INK) {
  let d = '';
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const bx = x + between(rand, -22, 22);
    const by = y + between(rand, -12, 12);
    const s = between(rand, 0.8, 1.25);
    d += `M ${r1(bx - 6 * s)} ${r1(by)} q ${r1(3 * s)} ${r1(-4 * s)} ${r1(6 * s)} 0 q ${r1(3 * s)} ${r1(-4 * s)} ${r1(6 * s)} 0 `;
    box[0] = Math.min(box[0], bx - 6 * s);
    box[1] = Math.min(box[1], by - 4 * s);
    box[2] = Math.max(box[2], bx + 6 * s);
    box[3] = Math.max(box[3], by + 1);
  }
  return { svg: `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`, box, kind: 'birds' };
}

const birds = (...args) => flock(...args).svg;

function boat(x, y, sail, hull = INK) {
  return (
    `<path d="M ${r1(x - 15)} ${r1(y)} L ${r1(x + 15)} ${r1(y)} L ${r1(x + 9)} ${r1(y + 6)} L ${r1(x - 9)} ${r1(y + 6)} Z" fill="${hull}"/>` +
    `<path d="M ${r1(x - 1)} ${r1(y - 26)} L ${r1(x - 1)} ${r1(y - 2)} L ${r1(x + 13)} ${r1(y - 2)} Z" fill="${sail}"/>` +
    `<path d="M ${r1(x - 1)} ${r1(y - 28)} L ${r1(x - 1)} ${r1(y)}" stroke="${hull}" stroke-width="1.6"/>`
  );
}

function torii(x, baseY, s, color) {
  const top = baseY - 46 * s;
  return (
    `<rect x="${r1(x - 16 * s)}" y="${r1(top + 6 * s)}" width="${r1(4.5 * s)}" height="${r1(40 * s)}" fill="${color}"/>` +
    `<rect x="${r1(x + 11.5 * s)}" y="${r1(top + 6 * s)}" width="${r1(4.5 * s)}" height="${r1(40 * s)}" fill="${color}"/>` +
    `<rect x="${r1(x - 21 * s)}" y="${r1(top + 13 * s)}" width="${r1(42 * s)}" height="${r1(3.5 * s)}" fill="${color}"/>` +
    `<path d="M ${r1(x - 27 * s)} ${r1(top)} Q ${r1(x)} ${r1(top + 5 * s)} ${r1(x + 27 * s)} ${r1(top)} L ${r1(x + 24 * s)} ${r1(top + 6 * s)} Q ${r1(x)} ${r1(top + 9 * s)} ${r1(x - 24 * s)} ${r1(top + 6 * s)} Z" fill="${INK}"/>`
  );
}

function pine(rand, x, baseY, s, side) {
  const dir = side === 'left' ? 1 : -1;
  const trunk = `M ${r1(x)} ${r1(baseY)} C ${r1(x + 8 * s * dir)} ${r1(baseY - 22 * s)} ${r1(x - 10 * s * dir)} ${r1(baseY - 40 * s)} ${r1(x + 6 * s * dir)} ${r1(baseY - 62 * s)}`;
  let out = `<path d="${trunk}" fill="none" stroke="#3a2b22" stroke-width="${r1(5 * s)}" stroke-linecap="round"/>`;
  const clumps = [
    [x + 6 * s * dir, baseY - 64 * s, 22],
    [x - 4 * s * dir, baseY - 46 * s, 18],
    [x + 16 * s * dir, baseY - 38 * s, 15],
  ];
  for (const [cx, cy, rx] of clumps) {
    const w = rx * s * between(rand, 0.9, 1.15);
    out += `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(w)}" ry="${r1(w * 0.36)}" fill="#24382c"/>`;
    out += `<ellipse cx="${r1(cx)}" cy="${r1(cy - w * 0.12)}" rx="${r1(w * 0.8)}" ry="${r1(w * 0.18)}" fill="#3d5a45"/>`;
  }
  return out;
}

function blossom(x, y, r) {
  let out = '';
  for (let k = 0; k < 5; k++) {
    const a = (Math.PI * 2 * k) / 5 - Math.PI / 2;
    out += `<circle cx="${r1(x + Math.cos(a) * r)}" cy="${r1(y + Math.sin(a) * r)}" r="${r1(r * 0.85)}" fill="#f2b8c6"/>`;
  }
  return out + `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * 0.45)}" fill="${VERMILION}"/>`;
}

// Ветка сакуры из верхнего угла с цветами и падающими лепестками.
function sakura(rand, W, H, side) {
  const dir = side === 'left' ? 1 : -1;
  const x0 = side === 'left' ? -6 : W + 6;
  const y0 = H * 0.06;
  const pt = (dx, dy) => `${r1(x0 + dx * dir)} ${r1(y0 + dy)}`;
  const len = Math.min(W * 0.55, 150);
  const d = `M ${pt(0, 0)} C ${pt(len * 0.35, -6)} ${pt(len * 0.55, 30)} ${pt(len, 26)}`;
  const twig = `M ${pt(len * 0.45, 12)} Q ${pt(len * 0.55, 48)} ${pt(len * 0.4, 70)}`;
  let out =
    `<path d="${d}" fill="none" stroke="#3a2b22" stroke-width="6" stroke-linecap="round"/>` +
    `<path d="${twig}" fill="none" stroke="#3a2b22" stroke-width="3.5" stroke-linecap="round"/>`;
  const spots = [
    [0.25, 2], [0.42, 6], [0.6, 18], [0.78, 22], [0.98, 24], [0.5, 40], [0.42, 64], [0.7, 8],
  ];
  for (const [t, dy] of spots) {
    const [x, y] = pt(len * t, dy + between(rand, -4, 4)).split(' ').map(Number);
    out += blossom(x, y, between(rand, 3.6, 5));
  }
  for (let i = 0; i < 7; i++) {
    const px = x0 + dir * between(rand, len * 0.3, len * 1.4);
    const py = y0 + between(rand, 40, H * 0.5);
    out += `<ellipse cx="${r1(px)}" cy="${r1(py)}" rx="2.6" ry="1.5" transform="rotate(${r1(between(rand, -40, 40))} ${r1(px)} ${r1(py)})" fill="#f2b8c6"/>`;
  }
  return out;
}

// Камень на воде — опора для сосны или просто деталь.
function rock(x, y, s, color = '#2a2f36', foam = CREAM) {
  return (
    `<path d="M ${r1(x - 20 * s)} ${r1(y)} Q ${r1(x - 14 * s)} ${r1(y - 14 * s)} ${r1(x - 2 * s)} ${r1(y - 12 * s)} Q ${r1(x + 10 * s)} ${r1(y - 18 * s)} ${r1(x + 20 * s)} ${r1(y)} Z" fill="${color}"/>` +
    `<path d="M ${r1(x - 24 * s)} ${r1(y + 2)} q ${r1(6 * s)} -3 ${r1(12 * s)} 0 M ${r1(x + 12 * s)} ${r1(y + 2)} q ${r1(6 * s)} -3 ${r1(12 * s)} 0" fill="none" stroke="${foam}" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>`
  );
}

function reeds(rand, x, y, color = '#2f3a2a') {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const bx = x + (i - 2.5) * 5 + between(rand, -1.5, 1.5);
    const hgt = between(rand, 18, 32);
    const lean = between(rand, -8, 8);
    d += `M ${r1(bx)} ${r1(y)} q ${r1(lean * 0.3)} ${r1(-hgt * 0.6)} ${r1(lean)} ${r1(-hgt)} `;
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
}

function lantern(x, y) {
  return (
    `<circle cx="${r1(x)}" cy="${r1(y - 4)}" r="11" fill="#f2c879" opacity=".25"/>` +
    `<rect x="${r1(x - 5)}" y="${r1(y - 10)}" width="10" height="10" rx="1.5" fill="#f2c879"/>` +
    `<rect x="${r1(x - 7)}" y="${r1(y)}" width="14" height="2.5" fill="${INK}"/>`
  );
}

function cloud(x, y, w, color) {
  return mist(x - w / 2, y, w, 7, color) + mist(x - w * 0.2, y - 6, w * 0.55, 6, color);
}

function shootingStar(x, y) {
  return (
    `<path d="M ${r1(x - 22)} ${r1(y - 10)} L ${r1(x)} ${r1(y)}" stroke="${CREAM}" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>` +
    `<circle cx="${r1(x)}" cy="${r1(y)}" r="2" fill="${CREAM}"/>`
  );
}

function island(x, y, color) {
  return (
    `<path d="M ${r1(x - 24)} ${r1(y)} Q ${r1(x - 8)} ${r1(y - 16)} ${r1(x + 4)} ${r1(y - 13)} Q ${r1(x + 16)} ${r1(y - 10)} ${r1(x + 24)} ${r1(y)} Z" fill="${color}"/>` +
    `<path d="M ${r1(x + 2)} ${r1(y - 12)} l 0 -12 M ${r1(x - 6)} ${r1(y - 22)} q 8 -5 16 0" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`
  );
}

// Один большой журавль в полёте.
function crane(x, y) {
  return (
    `<path d="M ${r1(x - 18)} ${r1(y - 6)} Q ${r1(x - 6)} ${r1(y - 2)} ${r1(x)} ${r1(y + 2)} Q ${r1(x + 6)} ${r1(y - 2)} ${r1(x + 18)} ${r1(y - 9)}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="M ${r1(x - 12)} ${r1(y + 3)} L ${r1(x + 14)} ${r1(y + 1)}" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="${r1(x + 15)}" cy="${r1(y + 0.5)}" r="1.8" fill="${VERMILION}"/>`
  );
}

// Детали, которые целиком помещаются в одну клетку (с отступом от краёв),
// чтобы клетки без крупных предметов всё равно отличались друг от друга.
// В одной картинке каждая деталь встречается не больше раза.
const FILLERS = {
  sky: {
    day: ['birds', 'cloud', 'crane', 'flock'],
    night: ['shooting', 'cloud', 'birds', 'crane'],
  },
  water: {
    day: ['rock', 'reeds', 'boat', 'island'],
    night: ['lantern', 'rock', 'boat', 'island'],
  },
};

function filler(rand, choice, x, y, sky) {
  const night = sky === SKIES.night;
  switch (choice) {
    case 'shooting': return shootingStar(x + 10, y);
    case 'cloud': return cloud(x, y, 44, sky.mist);
    case 'crane': return crane(x, y);
    case 'birds': return birds(rand, x, y, 2);
    case 'flock': return birds(rand, x, y, 4);
    case 'lantern': return lantern(x, y + 8);
    case 'rock': return rock(x, y + 14, between(rand, 0.7, 0.95), night ? '#0b1220' : '#2a2f36', sky.foam);
    case 'reeds': return reeds(rand, x, y + 20);
    case 'island': return island(x, y + 16, sky.mid);
    default: return boat(x, y + 14, VERMILION, night ? '#0b1220' : INK);
  }
}

// ---------- сцены ----------
// Каждая сцена получает холст, сторону солнца и цвета неба и возвращает SVG-слои.

function layout(rand, w, h) {
  const W = w * 100;
  const H = h * 100;
  const horizon = H * (h >= 3 ? between(rand, 0.6, 0.67) : between(rand, 0.56, 0.62));
  const side = rand() < 0.5 ? 'left' : 'right';
  const sunX = side === 'left' ? W * between(rand, 0.16, 0.3) : W * between(rand, 0.7, 0.84);
  const otherX = side === 'left' ? W * between(rand, 0.62, 0.74) : W * between(rand, 0.26, 0.38);
  return { W, H, horizon, side, other: side === 'left' ? 'right' : 'left', sunX, otherX };
}

// Слой картинки: SVG и, для заметных предметов, рамка [x0, y0, x1, y1] —
// по рамкам видно, в каких клетках уже есть что-то своё.
const bg = (svg) => ({ svg });
const thing = (svg, box, kind) => ({ svg, box, kind });

const SCENES = {
  fuji(rand, c, sky) {
    const { W, H, horizon, sunX, otherX } = c;
    const r = Math.min(W, H) * between(rand, 0.1, 0.12);
    const sunY = H * between(rand, 0.16, 0.24);
    const width = W * (W > 200 ? between(rand, 0.45, 0.55) : between(rand, 0.62, 0.74));
    const height = horizon - H * between(rand, 0.15, 0.22);
    const birdX = sunX + (otherX > sunX ? 34 : -34);
    const boatX = sunX + (otherX > sunX ? 20 : -20);
    const boatY = horizon + (H - horizon) * 0.55;
    return [
      bg(skyLayer(W, horizon, sky.sky)),
      thing(disc(sunX, sunY, r, sky.sun, true), [sunX - r, sunY - r, sunX + r, sunY + r]),
      flock(rand, birdX, sunY + 30, 3),
      bg(ridge(rand, W, horizon + 1, horizon, H * 0.08, sky.far)),
      thing(fuji(rand, otherX, horizon + 1, width, height, sky.mid, CREAM),
        [otherX - width / 2, horizon - height, otherX + width / 2, horizon]),
      bg(mist(otherX - width * 0.62, horizon - height * 0.42, width * 0.75, H * 0.045, sky.mist)),
      bg(mist(W * 0.08, horizon - H * 0.07, W * 0.42, H * 0.035, sky.mist, 0.8)),
      bg(water(rand, W, H, horizon, sky.water, sky.foam)),
      thing(reflection(sunX, horizon, r, sky.sun), [sunX - r * 0.75, horizon + 4, sunX + r * 0.75, horizon + 42]),
      thing(boat(boatX, boatY, CREAM), [boatX - 15, boatY - 28, boatX + 15, boatY + 6], 'boat'),
    ];
  },

  moon(rand, c) {
    const sky = SKIES.night;
    const { W, H, horizon, side, sunX, otherX } = c;
    const r = Math.min(W, H) * between(rand, 0.09, 0.11);
    const moonY = H * between(rand, 0.15, 0.22);
    const boatY = horizon + (H - horizon) * 0.5;
    const s = H > 200 ? 1.3 : 1;
    const pineX = side === 'left' ? W - 18 : 18;
    return [
      bg(skyLayer(W, horizon, sky.sky)),
      bg(stars(rand, W, horizon * 0.7, Math.round(W / 9))),
      thing(disc(sunX, moonY, r, sky.sun, true), [sunX - r, moonY - r, sunX + r, moonY + r]),
      bg(ridge(rand, W, horizon + 1, horizon - H * 0.02, H * 0.2, sky.far, 5)),
      bg(mist(otherX - W * 0.25, horizon - H * 0.12, W * 0.45, H * 0.04, sky.mist, 0.85)),
      bg(ridge(rand, W, horizon + 1, horizon, H * 0.1, sky.mid, 7)),
      bg(water(rand, W, H, horizon, sky.water, sky.foam)),
      thing(reflection(sunX, horizon, r, CREAM), [sunX - r * 0.75, horizon + 4, sunX + r * 0.75, horizon + 42]),
      thing(boat(otherX, boatY, '#d9c9a8', '#0b1220'), [otherX - 15, boatY - 28, otherX + 15, boatY + 6], 'boat'),
      thing(rock(pineX, horizon + 10, s * 1.2, '#0b1220', sky.foam) + pine(rand, pineX, horizon + 4, s, c.other),
        [pineX - 28 * s, horizon - 75 * s, pineX + 28 * s, horizon + 12], 'rock'),
    ];
  },

  sakura(rand, c, sky) {
    const { W, H, horizon, side, other, sunX, otherX } = c;
    const r = Math.min(W, H) * between(rand, 0.08, 0.1);
    const sunY = H * between(rand, 0.3, 0.36);
    const len = Math.min(W * 0.55, 150);
    const bx = (sunX + otherX) / 2;
    const branchBox = side === 'left' ? [W - len, 0, W, H * 0.06 + 80] : [0, 0, len, H * 0.06 + 80];
    return [
      bg(skyLayer(W, horizon, sky.sky)),
      thing(disc(sunX, sunY, r, sky.sun, true), [sunX - r, sunY - r, sunX + r, sunY + r]),
      bg(ridge(rand, W, horizon + 1, horizon, H * 0.12, sky.far, 5)),
      bg(mist(W * 0.1, horizon - H * 0.09, W * 0.55, H * 0.04, sky.mist)),
      bg(ridge(rand, W, horizon + 1, horizon, H * 0.05, sky.mid, 8)),
      bg(water(rand, W, H, horizon, sky.water, sky.foam)),
      thing(reflection(sunX, horizon, r, sky.sun), [sunX - r * 0.75, horizon + 4, sunX + r * 0.75, horizon + 42]),
      flock(rand, bx, H * 0.42, 2),
      thing(sakura(rand, W, H, other), branchBox),
    ];
  },

  torii(rand, c, sky) {
    const { W, H, horizon, sunX, otherX } = c;
    const r = Math.min(W, H) * between(rand, 0.13, 0.16);
    const s = H > 200 ? 1.6 : 1.15;
    const base = horizon + (H - horizon) * 0.62;
    const sunY = horizon - r * 0.9;
    return [
      bg(skyLayer(W, horizon, sky.sky)),
      thing(disc(sunX, sunY, r, sky.sun, true), [sunX - r, sunY - r, sunX + r, horizon]),
      bg(ridge(rand, W, horizon + 1, horizon, H * 0.07, sky.far, 6)),
      bg(mist(sunX - W * 0.3, horizon - r * 1.6, W * 0.5, H * 0.035, sky.mist, 0.85)),
      flock(rand, otherX, H * 0.2, 3),
      bg(water(rand, W, H, horizon, sky.water, sky.foam)),
      thing(reflection(sunX, horizon, r, sky.sun), [sunX - r * 0.75, horizon + 4, sunX + r * 0.75, horizon + 42]),
      thing(torii(otherX, base, s, VERMILION), [otherX - 27 * s, base - 46 * s, otherX + 27 * s, base]),
    ];
  },

  cranes(rand, c, sky) {
    const { W, H, horizon, side, sunX, otherX } = c;
    const r = Math.min(W, H) * between(rand, 0.1, 0.12);
    const sunY = H * between(rand, 0.18, 0.26);
    const s = H > 200 ? 1.5 : 1.15;
    const pineX = side === 'left' ? W - 24 : 24;
    const flockX = (sunX + otherX) / 2;
    return [
      bg(skyLayer(W, horizon, sky.sky)),
      thing(disc(sunX, sunY, r, sky.sun, true), [sunX - r, sunY - r, sunX + r, sunY + r]),
      bg(ridge(rand, W, horizon + 1, horizon - H * 0.03, H * 0.22, sky.far, 4)),
      bg(mist(otherX - W * 0.3, horizon - H * 0.16, W * 0.5, H * 0.045, sky.mist)),
      bg(ridge(rand, W, horizon + 1, horizon, H * 0.1, sky.mid, 6)),
      flock(rand, flockX, H * 0.3, 4),
      flock(rand, otherX, H * 0.14, 2),
      bg(water(rand, W, H, horizon, sky.water, sky.foam)),
      thing(reflection(sunX, horizon, r, sky.sun), [sunX - r * 0.75, horizon + 4, sunX + r * 0.75, horizon + 42]),
      thing(rock(pineX, horizon + 14, s * 1.1) + pine(rand, pineX, horizon + 8, s, c.other),
        [pineX - 28 * s, horizon - 70 * s, pineX + 28 * s, horizon + 16], 'rock'),
    ];
  },
};

// Клетки, где нет ни одного заметного предмета: туда добавляем свою деталь.
function emptyTiles(items, w, h) {
  const empty = [];
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const x0 = tx * 100;
      const y0 = ty * 100;
      const busy = items.some(({ box }) => {
        if (!box) return false;
        const ox = Math.min(box[2], x0 + 100) - Math.max(box[0], x0);
        const oy = Math.min(box[3], y0 + 100) - Math.max(box[1], y0);
        const area = (box[2] - box[0]) * (box[3] - box[1]);
        return ox > 0 && oy > 0 && ox * oy >= Math.max(700, area * 0.4);
      });
      if (!busy) empty.push([tx, ty]);
    }
  }
  return empty;
}

export const SCENE_NAMES = Object.keys(SCENES);

const SCENE_TITLES = {
  fuji: ['🗻', 'Гора'],
  moon: ['🌕', 'Луна над заливом'],
  sakura: ['🌸', 'Сакура'],
  torii: ['⛩️', 'Тории'],
  cranes: ['🕊️', 'Журавли'],
};
const SKY_TITLES = { dawn: 'на рассвете', day: 'днём', dusk: 'на закате', night: '' };

// Название картинки для альбома и «поделиться»: «🗻 Гора на закате».
export function pictureTitle({ scene, sky }, { emoji = true } = {}) {
  const [icon, name] = SCENE_TITLES[scene] ?? ['🖼️', 'Картинка'];
  const text = [name, SKY_TITLES[sky] ?? ''].filter(Boolean).join(' ');
  return emoji ? `${icon} ${text}` : text;
}

// SVG → адрес для background-image / <img>.
export function pictureUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Картинка: { svg, scene, sky }. Детерминирована: тот же rand — та же картинка.
export function drawPicture(rand, { w, h, scene = pick(rand, SCENE_NAMES) }) {
  const skyName = scene === 'moon' ? 'night' : pick(rand, ['dawn', 'day', 'dusk']);
  const sky = SKIES[skyName];
  const c = layout(rand, w, h);
  const items = SCENES[scene](rand, c, sky);
  const used = new Set(items.map((item) => item.kind));
  const time = skyName === 'night' ? 'night' : 'day';
  for (const [tx, ty] of emptyTiles(items, w, h)) {
    const cx = tx * 100 + between(rand, 34, 66);
    const cy = ty * 100 + between(rand, 30, 58);
    const where = cy < c.horizon - 12 ? 'sky' : 'water';
    // деталь не залезает на горизонт и на соседние клетки
    const y = where === 'sky' ? Math.min(cy, c.horizon - 30) : Math.max(cy, c.horizon + 10);
    const free = FILLERS[where][time].filter((kind) => !used.has(kind));
    const choice = pick(rand, free.length > 0 ? free : FILLERS[where][time]);
    used.add(choice);
    items.push({ svg: filler(rand, choice, cx, y, sky), kind: choice });
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.W} ${c.H}" width="${c.W}" height="${c.H}">` +
    items.map((item) => item.svg).join('') +
    `</svg>`;
  return { svg, scene, sky: skyName };
}
