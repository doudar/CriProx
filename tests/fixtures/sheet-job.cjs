const { registrationGeometry } = require('../../electron/cutter/geometry.cjs');
module.exports = function sheetJob() {
  return {
    kind: 'skarix-cut-job',
    version: 1,
    machine: 'explore-5',
    paper: 'letter',
    units: 'mm',
    origin: 'page-top-left',
    contourPosition: 'rotated-bounds-top-left',
    contourShape: 'rounded-rectangle',
    rotationDirection: 'clockwise',
    registrationMode: 'generated',
    cutSettings: { material: 'white-sticker-paper', pressurePreset: 'medium', passes: 1 },
    sheets: [
      {
        frontPdfPage: 1,
        registration: registrationGeometry('explore-5', 'letter'),
        contours: [{ x: 30, y: 30, width: 40, height: 15, radius: 2, rotation: 0 }],
      },
    ],
  };
};
