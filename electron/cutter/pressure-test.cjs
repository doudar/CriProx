// Material snapshots are validated again before creating native machine commands.
const { materialForSettings, passPressures, directCutIssue } = require('./materials.cjs');
function resolveCutSettings(settings, machine = settings?.machine ?? 'explore-5') {
  const profile = materialForSettings(settings || {}),
    pressures = passPressures(settings);
  const issue = directCutIssue(settings, machine);
  if (issue) throw Error(issue);
  return Object.freeze({
    material: settings.cutMaterial,
    materialName: profile.name,
    preset: settings.cutPressure,
    pressureGrams: pressures[0],
    passPressures: pressures,
    passes: settings.cutPasses,
  });
}
function createPressurePassSettings(T, settings) {
  const resolved = resolveCutSettings(settings);
  return resolved.passPressures.map(
    (pressure) =>
      new T.PressurePassSettings(
        1,
        new T.PressureValueSettings.Pressure(
          T.WeightMeasurement.fromGrams(pressure),
          T.LengthMeasurement.fromValue(0, T.UnitLength.millimeters),
        ),
        false,
      ),
  );
}
async function buildPressurePlot(api, settings, paths, scan) {
  const resolved = resolveCutSettings(settings);
  const { Bifrost: B, Tesseract: T, CriGeo: G } = api;
  const move = (speed, accel) =>
    new T.MovementSettings3D(
      new T.VelocityVector3DMeasurement(new T.Vector3D(speed, speed, 5)),
      new T.AccelerationVector3DMeasurement(new T.Vector3D(accel, accel, 150)),
    );
  const motion = materialForSettings(settings).motion;
  const cutting = move(motion[0], motion[1]),
    travel = move(motion[2], motion[3]);
  const tool = new B.PressureToolDescription(
    'dragKnife',
    'cut',
    B.PressureToolColor.fromHexString('#000000'),
  );
  const builder = T.PressurePlotBuilder.create();
  for (const [index, svg] of paths.entries())
    builder.addPath(
      T.PressurePathSettings.create(
        `criprox-contour-${index}`,
        T.PathMeasurement.fromValue(G.Path.withSVGString(svg), T.UnitLength.millimeters),
        createPressurePassSettings(T, settings),
        cutting,
        new T.PressureToolSettings(
          'fine-point',
          'blade',
          1,
          tool.getDefaultToolInformation().pathOffsetSettings,
          undefined,
          undefined,
        ),
      ),
    );
  builder.setMovementSettings(travel);
  const inch = T.LengthMeasurement.fromInches;
  const config = B.PressureMachinesPlotJobConfig.defaultConfig();
  config.materialAlignment = 'single';
  const machine = require('./bifrost-device.cjs').bifrostMachine(settings.machine ?? 'explore-5');
  config.material = new B.PressureMachinesMaterial(
    'matted',
    T.SizeMeasurement.fromInches(new G.Size(machine.mat.width, machine.mat.height)),
    new B.Margins(inch(1), inch(0.5), inch(1), inch(0.5)),
    T.LengthMeasurement.fromValue(0, T.UnitLength.millimeters),
  );
  builder.setCanvasRectangle(config.material.canvasRectangle);
  config.builder = builder;
  config.tools = new Map([['fine-point', tool]]);
  config.materialLengthToMeasure = inch(machine.mat.height);
  config.materialMeasurementMovementSettings = new T.MovementSettings1D(
    new T.VelocityMeasurement(3.5),
    new T.AccelerationMeasurement(13),
  );
  config.bladeAlignmentPressure = T.WeightMeasurement.fromGrams(70);
  config.bladeAlignmentMovementConfig = B.MovementConfig.create(travel, cutting);
  if (scan) {
    const mm = (value) => T.LengthMeasurement.fromValue(value, T.UnitLength.millimeters);
    config.ptcConfig = new B.PressureMachinesPlotJobPTCConfig(
      new B.FiducialScanInputData(
        mm(scan.thickness),
        mm(scan.padding),
        T.PointMeasurement.fromInches(new G.Point(scan.frame.x / 25.4, scan.frame.y / 25.4)),
        T.SizeMeasurement.fromInches(new G.Size(scan.frame.width / 25.4, scan.frame.height / 25.4)),
        T.SizeMeasurement.fromInches(new G.Size(scan.page.width / 25.4, scan.page.height / 25.4)),
      ),
      inch(0.4),
      new B.PrintThenCutDebugDataType.Basic(),
    );
  }
  const plot = (await builder.buildAsync()).getOrUndefined();
  if (
    !plot ||
    plot.paths.reduce((n, p) => n + p.numberOfPasses, 0) !== resolved.passes * paths.length ||
    resolved.passPressures.some(
      (pressure) =>
        plot.paths
          .filter((p) => p.pressureValueSettings.value.grams === pressure)
          .reduce((sum, p) => sum + p.numberOfPasses, 0) !==
        resolved.passPressures.filter((p) => p === pressure).length * paths.length,
    )
  )
    throw Error('Could not verify native pressure and pass settings.');
  return { config, resolved, plot };
}
// Retained only for offline regression probes, not exposed by the desktop app.
async function buildPressureTest(api, settings) {
  return buildPressurePlot(api, settings, ['M25.4 25.4 L38.1 25.4 L38.1 38.1 L25.4 38.1 Z']);
}
async function startPressureTest({
  api,
  device,
  settings,
  onUpdate = () => {},
  onReadyToCut = () => {},
  build = buildPressureTest,
  requireScan = false,
  autoStart = false,
  onPhase = () => {},
}) {
  if (settings?.materialReady !== true)
    throw Error('The cutter requires prepared material and a fine-point blade.');
  const before = await device.moveSkill.getCarriageStatus();
  if (before.carriageState !== 'idle' || before.queuedMovesCount !== 0)
    throw Error('The cutter must be idle before starting a cut.');
  const { config, resolved } = await build(api, settings);
  config.initialTools = await device.toolSkill.getInitialTools(config.tools, config.builder);
  if (!config.initialTools?.size)
    throw Error('Could not resolve the fine-point blade for this cutter.');
  const E = api.Bifrost.PressureMachinesPlotJobEvent;
  let completed = false,
    readyToCut = false,
    cutRequested = false,
    cancelled = false,
    failed = false,
    scanned = !requireScan,
    paused = false;
  const messages = {
    WaitingForMaterialLoad: 'Load the mat using the cutter’s Load button.',
    WaitingForMaterialMeasurement: 'Mat loaded. Preparing to measure it…',
    WaitingForPlotStart: autoStart
      ? 'Mat measured. Starting registration scan and cut…'
      : 'Mat measured. Choose Cut test square in Skarix to start the cut.',
    MaterialMeasurementStarted: 'Measuring the loaded mat…',
    PlotStarted: `Cutting: ${resolved.pressureGrams} g, ${resolved.passes} pass(es)…`,
    PlotPaused: 'Paused. Choose Resume or Cancel in Skarix.',
    WaitingForMaterialUnload: 'Unload the mat using the cutter’s button.',
    WaitingForUserAction: 'The cutter needs attention. Check the blade and machine indicators.',
  };
  // Bifrost awaits this callback through its WASM Promise bridge, including terminal events.
  const token = await device.plotJob.registerEventsCallback(async (event) => {
    if (requireScan && event instanceof E.PrintThenCutFiducialScanStarted) {
      onPhase('scanning');
      onUpdate('Scanning the printed registration marks…');
    }
    if (requireScan && event instanceof E.PrintThenCutFiducialScanCompleted) {
      scanned = event.result?.isSuccess() === true;
      if (!scanned) {
        failed = true;
        onUpdate(
          'Registration scan failed. Cancelling without cutting. Check the printed marks and sheet placement.',
        );
        void device.plotJob.cancel().catch(() => {});
      } else onUpdate('Registration marks found. Cutting the matching contours…');
    }
    if (
      requireScan &&
      E.WaitingForPrintThenCutRestart &&
      event instanceof E.WaitingForPrintThenCutRestart
    ) {
      if (!failed) {
        failed = true;
        void device.plotJob.cancel().catch(() => {});
      }
      onUpdate(
        'Registration scan needs a retry. This job is cancelled; inspect the marks before preparing another cut.',
      );
    }
    for (const name of [
      'PlotPaused',
      'PrintThenCutFiducialScanPaused',
      'MaterialMeasurementPaused',
    ]) {
      if (E[name] && event instanceof E[name]) {
        paused = true;
        onPhase('paused');
        onUpdate('Paused. Choose Resume or Cancel in Skarix.');
      }
    }
    for (const name of [
      'PlotResume',
      'PrintThenCutFiducialScanResume',
      'MaterialMeasurementResume',
    ]) {
      if (E[name] && event instanceof E[name]) {
        paused = false;
        onPhase('working');
      }
    }
    if (event instanceof E.WaitingForPlotStart && !cancelled && !cutRequested) {
      readyToCut = true;
      onReadyToCut(true);
      if (autoStart && !failed) {
        cutRequested = true;
        readyToCut = false;
        onReadyToCut(false);
        await device.plotJob.resume();
      }
    }
    if (event instanceof E.PlotStarted) {
      onPhase('cutting');
      cutRequested = true;
      readyToCut = false;
      onReadyToCut(false);
    }
    if (event instanceof E.PlotCompleted) {
      completed = !event.error;
      failed ||= !!event.error;
    }
    if (event instanceof E.Finished) failed ||= !!event.error;
    for (const [name, message] of Object.entries(messages))
      if (event instanceof E[name]) onUpdate(message);
    // The engine pauses here after loading; hardware Go does not release this barrier.
    if (event instanceof E.WaitingForMaterialMeasurement && !cancelled && !failed)
      await device.plotJob.resume();
  });
  const done = (async () => {
    try {
      await device.plotJob.start(config);
      if (cancelled) return { cancelled: true };
      if (!completed || failed || !scanned)
        throw Error('The cutter did not confirm a successful cut and registration scan.');
      const after = await device.moveSkill.getCarriageStatus();
      if (after.carriageState !== 'idle' || after.queuedMovesCount !== 0)
        throw Error('The cut finished but the carriage is not idle.');
      return { cancelled: false };
    } finally {
      token?.unregister();
    }
  })();
  return {
    resolved,
    done,
    async pause() {
      await device.plotJob.pause();
    },
    async resume() {
      if (!paused || failed || cancelled) throw Error('The cutter is not ready to resume.');
      paused = false;
      onPhase('working');
      await device.plotJob.resume();
    },
    async startCut() {
      if (!readyToCut || cancelled || cutRequested)
        throw Error('The cutter is not waiting to start this test.');
      cutRequested = true;
      readyToCut = false;
      onReadyToCut(false);
      await device.plotJob.resume();
    },
    async cancel() {
      cancelled = true;
      readyToCut = false;
      onReadyToCut(false);
      await device.plotJob.cancelAndWaitForFinish();
    },
    async abort() {
      cancelled = true;
      readyToCut = false;
      onReadyToCut(false);
      await device.plotJob.abortAndWaitForFinish();
    },
  };
}
module.exports = {
  resolveCutSettings,
  createPressurePassSettings,
  buildPressureTest,
  buildPressurePlot,
  startPressureTest,
};
