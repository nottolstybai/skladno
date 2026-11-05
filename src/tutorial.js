// Обучающий уровень: 4 клетки и один сгиб.
//
//   лицо:     🟨 🟨 | 🟦 🟦
//   изнанка:  🟧 🟧 | 🟩 🟩
//
// Образец — 🟧🟧: его видно только в уголках левых клеток. Если загнуть левую
// половину направо, сверху окажется её изнанка — и проступит «ДА».
export const TUTORIAL_LEVEL = {
  w: 4,
  h: 1,
  faces: [
    { color: 4, letter: '' }, // клетка 0, лицо
    { color: 1, letter: 'А' }, // клетка 0, изнанка
    { color: 4, letter: '' }, // клетка 1, лицо
    { color: 1, letter: 'Д' }, // клетка 1, изнанка
    { color: 2, letter: '' },
    { color: 3, letter: '' },
    { color: 2, letter: '' },
    { color: 3, letter: '' },
  ],
  target: [1, 1],
  targetW: 2,
  targetH: 1,
  folds: 1,
  word: 'ДА',
  solution: [{ axis: 'x', at: 2, from: 'start' }],
};

// Единственная линия, которую можно трогать в обучении.
export const TUTORIAL_CREASE = 2;
