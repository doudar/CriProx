// Original, editable example artwork. Coordinates are millimeters, not pixels.
function landscapeLayers() {
  const e = [];
  const shape = (id, shape, x, y, width, height, fill, extra = {}) =>
    e.push({ id, kind: 'shape', shape, x, y, width, height, fill, strokeWidth: 0, ...extra });
  const polygon = (id, points, fill, extra = {}) => {
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]),
      x = Math.min(...xs),
      y = Math.min(...ys),
      width = Math.max(...xs) - x,
      height = Math.max(...ys) - y;
    e.push({
      id,
      kind: 'draw',
      x,
      y,
      width: Math.max(0.1, width),
      height: Math.max(0.1, height),
      points: points.map((p) => ({
        x: (p[0] - x) / Math.max(0.1, width),
        y: (p[1] - y) / Math.max(0.1, height),
      })),
      closed: true,
      fill,
      strokeWidth: 0,
      ...extra,
    });
  };
  const skies = [
    '#94c5de',
    '#9bcbe1',
    '#a3d1e5',
    '#acd8e8',
    '#b6dfea',
    '#c1e5ed',
    '#ccebef',
    '#d8eff0',
  ];
  skies.forEach((fill, i) => shape(`sky-${i}`, 'rectangle', 0, i * 3.7, 80, 4, fill));
  shape('sun-glow', 'ellipse', 56, 5, 19, 19, '#fff4cb', { opacity: 0.35 });
  shape('sun', 'ellipse', 60, 9, 11, 11, '#fff7d6');
  for (let i = 0; i < 9; i++)
    shape(`cloud-${i}`, 'ellipse', 5 + i * 6, 7 + (i % 3) * 2, 10, 2, '#eff8f5', { opacity: 0.6 });
  polygon(
    'distant-ridge',
    [
      [0, 27],
      [9, 15],
      [18, 26],
      [30, 9],
      [42, 27],
      [53, 16],
      [68, 28],
      [78, 20],
      [80, 34],
      [0, 34],
    ],
    '#9ab2bf',
  );
  polygon(
    'mid-ridge',
    [
      [0, 33],
      [16, 17],
      [27, 30],
      [42, 13],
      [61, 34],
      [73, 24],
      [80, 32],
      [80, 42],
      [0, 42],
    ],
    '#617e92',
  );
  polygon(
    'left-snow',
    [
      [5, 28],
      [16, 17],
      [21, 25],
      [17, 23],
      [14, 25],
      [12, 23],
    ],
    '#e8f4ef',
  );
  polygon(
    'summit-snow',
    [
      [33, 23],
      [42, 13],
      [51, 24],
      [45, 21],
      [42, 24],
      [39, 20],
    ],
    '#eff6ee',
  );
  polygon(
    'mountain-shadow',
    [
      [42, 13],
      [61, 34],
      [45, 29],
      [39, 28],
    ],
    '#4d697c',
  );
  for (let i = 0; i < 16; i++) {
    const x = 1 + i * 4.8;
    e.push({
      id: `ridge-detail-${i}`,
      kind: 'line',
      x,
      y: 29 + (i % 3),
      width: 2.2,
      height: 2.5,
      stroke: '#c7d9db',
      strokeWidth: 0.12,
      opacity: 0.55,
    });
  }
  polygon(
    'far-shore',
    [
      [0, 37],
      [14, 34],
      [29, 36],
      [43, 33],
      [61, 37],
      [80, 34],
      [80, 44],
      [0, 44],
    ],
    '#496e72',
  );
  polygon(
    'lake',
    [
      [0, 39],
      [15, 38],
      [30, 40],
      [48, 37],
      [66, 40],
      [80, 39],
      [80, 56],
      [0, 56],
    ],
    '#6aa5b3',
  );
  for (let i = 0; i < 22; i++)
    shape(
      `reflection-${i}`,
      'rectangle',
      ((i * 17) % 67) + 3,
      40 + i * 0.6,
      3 + (i % 5) * 2,
      0.16,
      i % 2 ? '#9ac8ca' : '#c5dcd4',
      { opacity: 0.65 },
    );
  polygon(
    'near-shore',
    [
      [0, 48],
      [7, 45],
      [15, 48],
      [22, 51],
      [34, 54],
      [47, 53],
      [61, 50],
      [72, 45],
      [80, 47],
      [80, 56],
      [0, 56],
    ],
    '#294f52',
  );
  for (let i = 0; i < 20; i++) {
    const x = (i * 3.7) % 76,
      h = 5 + (i % 6) * 1.3,
      y = (i < 10 ? 44 : 48) - h;
    shape(`trunk-${i}`, 'rectangle', x + 1.3, y + h * 0.3, 0.45, h, '#34554c');
    for (let j = 0; j < 3; j++)
      shape(
        `pine-${i}-${j}`,
        'triangle',
        x - j * 0.22,
        y + j * h * 0.2,
        3 + j * 0.45,
        h * 0.64,
        j === 0 ? '#376b64' : j === 1 ? '#285a54' : '#204943',
      );
    e.push({
      id: `pine-light-${i}`,
      kind: 'line',
      x: x + 0.7,
      y: y + 0.9,
      width: 0.3,
      height: h * 0.4,
      stroke: '#70988b',
      strokeWidth: 0.13,
      opacity: 0.7,
    });
  }
  polygon(
    'foreground',
    [
      [0, 54],
      [9, 51],
      [18, 53],
      [29, 55],
      [39, 54],
      [51, 55],
      [62, 52],
      [74, 51],
      [80, 53],
      [80, 56],
      [0, 56],
    ],
    '#183b3d',
  );
  for (let i = 0; i < 16; i++)
    shape(`grass-${i}`, 'triangle', i * 5, 53 + (i % 2), 0.6, 2, '#568777');
  return e;
}
function heroLayers() {
  return [
    {
      id: 'hero-cloak',
      kind: 'draw',
      x: 21,
      y: 29,
      width: 23,
      height: 22,
      closed: true,
      points: [
        { x: 0.5, y: 0 },
        { x: 0.82, y: 0.16 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 0.18, y: 0.16 },
      ],
      fill: '#263b65',
    },
    {
      id: 'hero-collar',
      kind: 'draw',
      x: 25,
      y: 29,
      width: 15,
      height: 9,
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.3 },
        { x: 1, y: 0 },
        { x: 0.65, y: 1 },
        { x: 0.35, y: 1 },
      ],
      fill: '#d7bb77',
    },
    {
      id: 'hero-face',
      kind: 'shape',
      shape: 'ellipse',
      x: 28,
      y: 20,
      width: 9,
      height: 12,
      fill: '#d9a789',
    },
    {
      id: 'hero-hair',
      kind: 'draw',
      x: 27,
      y: 18,
      width: 12,
      height: 10,
      closed: true,
      points: [
        { x: 0, y: 1 },
        { x: 0.02, y: 0.25 },
        { x: 0.3, y: 0 },
        { x: 0.75, y: 0.05 },
        { x: 1, y: 0.4 },
        { x: 0.9, y: 1 },
        { x: 0.65, y: 0.3 },
        { x: 0.3, y: 0.35 },
      ],
      fill: '#342b3c',
    },
    {
      id: 'left-eye',
      kind: 'line',
      x: 30,
      y: 25,
      width: 1.1,
      height: 0.1,
      stroke: '#29313f',
      strokeWidth: 0.2,
    },
    {
      id: 'right-eye',
      kind: 'line',
      x: 34,
      y: 25,
      width: 1.1,
      height: 0.1,
      stroke: '#29313f',
      strokeWidth: 0.2,
    },
    {
      id: 'staff',
      kind: 'line',
      x: 43,
      y: 22,
      width: 1.4,
      height: 28,
      stroke: '#d1ad6c',
      strokeWidth: 0.7,
    },
    {
      id: 'staff-gem',
      kind: 'shape',
      shape: 'diamond',
      x: 41.7,
      y: 19,
      width: 4,
      height: 6,
      fill: '#a9e4d6',
      stroke: '#efd897',
      strokeWidth: 0.25,
    },
    {
      id: 'brooch',
      kind: 'shape',
      shape: 'star',
      x: 31,
      y: 35,
      width: 3,
      height: 3,
      fill: '#e7c977',
    },
  ];
}
module.exports = { landscapeLayers, heroLayers };
