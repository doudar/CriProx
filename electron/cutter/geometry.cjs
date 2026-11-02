// Shared print, preview, and native cut geometry. All coordinates are millimeters.
const MM_PER_PT = 25.4 / 72;
const REGISTRATION_METRICS = {
  arm: 72 * MM_PER_PT,
  thickness: 4.25197 * MM_PER_PT,
  edgeInset: 36 * MM_PER_PT,
  clearance: 18 * MM_PER_PT,
  printBleed: 2 * MM_PER_PT,
};
function registrationGeometry(machine, paper) {
  const page = paper === 'letter' ? { width: 215.9, height: 279.4 } : { width: 210, height: 297 };
  const m = REGISTRATION_METRICS;
  const x = m.edgeInset,
    y = m.edgeInset;
  const frame = { x, y, width: page.width - 2 * x, height: page.height - 2 * y };
  const marks = [],
    keepOuts = [];
  if (machine !== 'manual')
    for (let corner = 0; corner < 4; corner++) {
      const right = corner % 2 === 1,
        bottom = corner >= 2;
      const origin = {
        x: right ? frame.x + frame.width : frame.x,
        y: bottom ? frame.y + frame.height : frame.y,
      };
      const point = (x2, y2) => ({
        x: origin.x + (right ? -x2 : x2),
        y: origin.y + (bottom ? -y2 : y2),
      });
      const rectangle = (x2, y2, w, h) => [
        point(x2, y2),
        point(x2 + w, y2),
        point(x2 + w, y2 + h),
        point(x2, y2 + h),
      ];
      if (corner === 0) {
        marks.push(rectangle(2 * m.thickness, 0, m.arm - 2 * m.thickness, m.thickness));
        marks.push(rectangle(0, 2 * m.thickness, m.thickness, m.arm - 2 * m.thickness));
        marks.push([
          point(m.thickness / 2, 0),
          point(m.thickness, m.thickness),
          point(0, m.thickness),
        ]);
      } else marks.push(rectangle(0, 0, m.arm, m.thickness), rectangle(0, 0, m.thickness, m.arm));
      for (const [w, h] of [
        [m.arm + m.clearance, m.thickness + m.clearance],
        [m.thickness + m.clearance, m.arm + m.clearance],
      ])
        keepOuts.push({
          x: right ? origin.x - w : origin.x,
          y: bottom ? origin.y - h : origin.y,
          width: w,
          height: h,
        });
    }
  return {
    page,
    frame,
    marks,
    keepOuts,
    source: 'cricut-machine-metrics-10.8.81',
    placement: 'skarix-page-frame-v2',
  };
}
function registrationOrigin(paper, area) {
  const { page } = registrationGeometry('explore-5', paper);
  return { x: (page.width - area.width) / 2, y: (page.height - area.height) / 2 };
}
function polygonPath(points) {
  return (
    points.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(6)} ${p.y.toFixed(6)}`).join(' ') + ' Z'
  );
}
function shapePolygon(shape, bleed = 0) {
  const a = (shape.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a),
    w = shape.width,
    h = shape.height;
  const bounds = {
    width: w * Math.abs(c) + h * Math.abs(s),
    height: w * Math.abs(s) + h * Math.abs(c),
  };
  const cx = shape.x + bounds.width / 2,
    cy = shape.y + bounds.height / 2;
  const radius = Math.min(shape.radius, w / 2, h / 2) + bleed,
    halfW = w / 2 + bleed,
    halfH = h / 2 + bleed;
  const points = [];
  for (let corner = 0; corner < 4; corner++) {
    const centers = [
      [halfW - radius, halfH - radius],
      [-halfW + radius, halfH - radius],
      [-halfW + radius, -halfH + radius],
      [halfW - radius, -halfH + radius],
    ];
    const [x, y] = centers[corner];
    for (let step = 0; step <= 24; step++) {
      const theta = ((corner * 90 + (step * 90) / 24) * Math.PI) / 180,
        px = x + radius * Math.cos(theta),
        py = y + radius * Math.sin(theta);
      points.push({ x: cx + px * c - py * s, y: cy + px * s + py * c });
    }
  }
  return points;
}
function polygonIntersects(a, b) {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i],
        q = poly[(i + 1) % poly.length],
        nx = -(q.y - p.y),
        ny = q.x - p.x;
      if (Math.hypot(nx, ny) < 1e-9) continue;
      const pa = a.map((p2) => p2.x * nx + p2.y * ny),
        pb = b.map((p2) => p2.x * nx + p2.y * ny);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-7 || Math.max(...pb) <= Math.min(...pa) + 1e-7)
        return false;
    }
  return true;
}
const rectPolygon = (r) => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height },
];
function registrationConflicts(shapes, geometry, bleed = 0) {
  const blocked = [],
    clearance = [];
  for (const shape of shapes) {
    const polygon = shapePolygon(shape, bleed);
    if (
      polygon.some(
        (p) => p.x < 0 || p.y < 0 || p.x > geometry.page.width || p.y > geometry.page.height,
      ) ||
      geometry.marks.some((mark) => polygonIntersects(polygon, mark))
    )
      blocked.push(shape.itemId);
    else if (geometry.keepOuts.some((zone) => polygonIntersects(polygon, rectPolygon(zone))))
      clearance.push(shape.itemId);
  }
  return { blocked, clearance };
}
module.exports = {
  MM_PER_PT,
  REGISTRATION_METRICS,
  polygonPath,
  registrationConflicts,
  registrationGeometry,
  registrationOrigin,
  shapePolygon,
};
