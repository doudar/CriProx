const {
  registrationGeometry,
  REGISTRATION_METRICS: metrics,
  shapePolygon,
  polygonPath,
  registrationConflicts,
} = require('./geometry.cjs');
const { resolveCutSettings, buildPressurePlot, startPressureTest } = require('./pressure-test.cjs');
const { getMachine, generatedSheetIssue } = require('../cutters/catalog.cjs');

function prepareSheetJob(text, sheetIndex) {
  if (typeof text !== 'string' || text.length > 8_000_000) throw Error('Invalid cut job file.');
  const job = JSON.parse(text);
  const machine = getMachine(job?.machine);
  if (
    !['skarix-cut-job', 'criprox-cut-job'].includes(job?.kind) ||
    ![1, 2].includes(job.version) ||
    !machine.directCut ||
    generatedSheetIssue(machine.id, job.paper) ||
    !['letter', 'a4'].includes(job.paper) ||
    job.units !== 'mm' ||
    job.origin !== 'page-top-left' ||
    job.contourPosition !== (job.version === 2 ? 'page-points' : 'rotated-bounds-top-left') ||
    job.contourShape !== (job.version === 2 ? 'paths' : 'rounded-rectangle') ||
    job.rotationDirection !== 'clockwise' ||
    job.registrationMode !== 'generated' ||
    !Array.isArray(job.sheets) ||
    job.sheets.length > 24 ||
    !Number.isInteger(sheetIndex) ||
    sheetIndex < 0 ||
    sheetIndex >= job.sheets.length
  )
    throw Error('Invalid or unsupported registered sheet job.');
  const sheet = job.sheets[sheetIndex],
    geometry = registrationGeometry(machine.id, job.paper);
  if (
    sheet?.registration?.placement !== geometry.placement ||
    ['x', 'y', 'width', 'height'].some(
      (k) => sheet.registration.frame?.[k] !== geometry.frame[k],
    ) ||
    sheet.registration.page?.width !== geometry.page.width ||
    sheet.registration.page?.height !== geometry.page.height ||
    !Array.isArray(sheet.contours) ||
    !sheet.contours.length ||
    sheet.contours.length > (job.version === 2 ? 2000 : 500)
  )
    throw Error('Invalid registration frame or sheet contours. Prepare the print again.');
  let pointCount = 0;
  const contours = sheet.contours.map((value, index) => {
    if (job.version === 2) {
      if (
        !value ||
        typeof value.closed !== 'boolean' ||
        !Array.isArray(value.points) ||
        value.points.length < (value.closed ? 3 : 2) ||
        value.points.length > 2000 ||
        value.points.some(
          (p) =>
            !p ||
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            p.x < 0 ||
            p.y < 0 ||
            p.x > geometry.page.width ||
            p.y > geometry.page.height,
        )
      )
        throw Error('Invalid custom cut path.');
      pointCount += value.points.length;
      if (pointCount > 200000) throw Error('Too many cut path points.');
      const points = value.points.map((p) => ({ x: p.x, y: p.y }));
      const x = Math.min(...points.map((p) => p.x)),
        y = Math.min(...points.map((p) => p.y));
      const width = Math.max(...points.map((p) => p.x)) - x,
        height = Math.max(...points.map((p) => p.y)) - y;
      if (Math.hypot(width, height) < 0.05) throw Error('Cut path is too short.');
      // Conservative bounds also protect concave and open paths against sensor marks.
      const bounds = {
        x,
        y,
        width: Math.max(width, 0.00001),
        height: Math.max(height, 0.00001),
        radius: 0,
        rotation: 0,
        itemId: `contour-${index}`,
      };
      if (registrationConflicts([bounds], geometry).blocked.length)
        throw Error('The cutter job crosses registration marks or the paper edge.');
      return { points, closed: value.closed };
    }
    if (
      !value ||
      ['x', 'y', 'width', 'height', 'radius', 'rotation'].some((k) => !Number.isFinite(value[k])) ||
      value.width <= 0 ||
      value.height <= 0 ||
      value.width > 300 ||
      value.height > 300 ||
      value.radius < 0 ||
      value.radius > Math.min(value.width, value.height) / 2 ||
      Math.abs(value.rotation) > 360
    )
      throw Error('Invalid cut contour dimensions.');
    return {
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      radius: value.radius,
      rotation: value.rotation,
      itemId: `contour-${index}`,
    };
  });
  if (job.version === 1 && registrationConflicts(contours, geometry).blocked.length)
    throw Error('The cutter job crosses registration marks or the paper edge.');
  const settings = {
    machine: machine.id,
    cutMaterial: job.cutSettings?.material,
    cutPressure: job.cutSettings?.pressurePreset,
    cutPasses: job.cutSettings?.passes,
    cutProfile: job.cutSettings?.profile,
  };
  const resolved = resolveCutSettings(settings);
  // Design Space subtracts the inner frame origin before supplying PTC paths to Bifrost.
  const padding = metrics.clearance + metrics.printBleed;
  const origin = {
    x: geometry.frame.x + metrics.thickness + padding,
    y: geometry.frame.y + metrics.thickness + padding,
  };
  const paths = contours.map((shape) => {
    const points = (job.version === 2 ? shape.points : shapePolygon(shape)).map((p) => ({
      x: p.x - origin.x,
      y: p.y - origin.y,
    }));
    const path = polygonPath(points);
    return job.version === 2 && !shape.closed ? path.slice(0, -2) : path;
  });
  return {
    machine: machine.id,
    settings,
    resolved,
    paths,
    scan: { frame: geometry.frame, page: geometry.page, thickness: metrics.thickness, padding },
    sheetNumber: sheetIndex + 1,
    totalSheets: job.sheets.length,
    contourCount: contours.length,
  };
}
async function buildSheetJob(api, text, sheetIndex) {
  const prepared = prepareSheetJob(text, sheetIndex);
  const built = await buildPressurePlot(api, prepared.settings, prepared.paths, prepared.scan);
  if (!built.config.ptcConfig) throw Error('Could not prepare the registration scan.');
  return { ...built, prepared };
}
async function startSheetJob({ api, device, request, onUpdate, onPhase, machine = 'explore-5' }) {
  if (request?.materialReady !== true)
    throw Error('Confirm the printed sheet, fine-point blade, and mat placement first.');
  const prepared = prepareSheetJob(request.job, request.sheetIndex);
  if (prepared.machine !== machine)
    throw Error('The prepared sheet belongs to a different cutter.');
  return startPressureTest({
    api,
    device,
    settings: { ...prepared.settings, materialReady: true },
    onUpdate,
    onPhase,
    autoStart: true,
    requireScan: true,
    build: () => buildSheetJob(api, request.job, request.sheetIndex),
  });
}
module.exports = { prepareSheetJob, buildSheetJob, startSheetJob };
