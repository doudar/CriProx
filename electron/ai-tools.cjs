// Shared, closed design-only tool catalogue. Neither the MCP router nor the renderer
// accepts arbitrary IPC channels, JavaScript, printer commands, or cutter commands.
const { z } = require('zod/v4');
const { appearance } = require('./design-appearance.cjs');
const mode = z.enum(['stickers']);
const color = z.string().regex(/^(#[0-9a-f]{6}|transparent)$/i);
const id = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
const text = z.string().max(2000);
const raster = z
  .string()
  .max(14_000_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
const element = z.strictObject({
  id: id.optional(),
  kind: z.enum(['text', 'shape', 'image', 'line', 'draw', 'group']).optional(),
  operation: z.enum(['print', 'cut']).optional(),
  closed: z.boolean().optional(),
  x: z.number().min(-500).max(500).optional(),
  y: z.number().min(-500).max(500).optional(),
  width: z.number().min(0.1).max(500).optional(),
  height: z.number().min(0.1).max(500).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  fill: color.optional(),
  ...appearance,
  stroke: color.optional(),
  strokeWidth: z.number().min(0).max(20).optional(),
  opacity: z.number().min(0).max(1).optional(),
  cornerRadius: z.number().min(0).max(250).optional(),
  shape: z
    .enum(['rectangle', 'ellipse', 'triangle', 'diamond', 'star', 'heart', 'hexagon'])
    .optional(),
  text: text.optional(),
  font: z.enum(['Arial', 'Georgia', 'Courier New']).optional(),
  fontSize: z.number().min(0.5).max(100).optional(),
  bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  image: raster.optional(),
  points: z
    .array(z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
    .min(2)
    .max(2000)
    .optional(),
});
const canvas = z.strictObject({
  reference: z
    .strictObject({
      image: raster,
      opacity: z.number().min(0).max(1),
      visible: z.boolean(),
      x: z.number().min(-500).max(500),
      y: z.number().min(-500).max(500),
      width: z.number().min(0.1).max(500),
      height: z.number().min(0.1).max(500),
    })
    .nullable()
    .optional(),
  grid: z
    .strictObject({ visible: z.boolean(), snap: z.boolean(), spacing: z.number().min(0.5).max(50) })
    .optional(),
  width: z.number().min(10).max(250).optional(),
  height: z.number().min(10).max(250).optional(),
  background: color.optional(),
});
const pose = z.strictObject({
  sheet: z.number().int().min(0).max(23).optional(),
  x: z.number().min(0).max(300).optional(),
  y: z.number().min(0).max(300).optional(),
  width: z.number().min(1).max(250).optional(),
  height: z.number().min(1).max(250).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  radius: z.number().min(0).max(125).optional(),
});
const tools = [
  [
    'list_material_presets',
    'List built-in illustration materials and optionally saved materials for a design. These are artwork styles, not cutter settings.',
    z.strictObject({ workspace: mode, designId: id.optional() }),
    true,
  ],
  [
    'resolve_editor_operation',
    'Explicitly save or discard the active designer draft. First read get_editor_state and obtain human authorization; confirm must be true and operationId must match. Never automatically discard human work to unblock AI edits.',
    z.strictObject({
      workspace: mode,
      action: z.enum(['save', 'cancel']),
      operationId: id,
      confirm: z.literal(true),
    }),
    false,
  ],
  [
    'get_editor_state',
    'Inspect editor activity and safe recovery actions, including while a human is editing. Does not change or discard drafts.',
    z.strictObject({ workspace: mode }),
    true,
  ],
  [
    'preflight_design',
    'Read-only diagnostics before creation: actual counts, limits, render dimensions and actionable reductions. Provide a designId or proposed canvas/elements. Does not render or mutate the workspace; compressed PNG size remains unknown.',
    z.strictObject({
      workspace: mode,
      designId: id.optional(),
      canvas: z.record(z.string(), z.unknown()).optional(),
      elements: z.array(z.record(z.string(), z.unknown())).max(1000).optional(),
    }),
    true,
  ],
  [
    'manage_design',
    'Duplicate or delete a sticker-library design. Deleting a sticker design also removes its placed copies; Undo restores them.',
    z.strictObject({
      workspace: mode,
      designId: id,
      action: z.enum(['duplicate', 'delete']),
      name: z.string().min(1).max(100).optional(),
      copies: z.number().int().min(0).max(100).default(1),
    }),
    false,
  ],
  [
    'get_design_capabilities',
    'Read the design guide, limits, layer schema, coordinate system and suggested illustration workflow.',
    z.strictObject({}),
    true,
  ],
  [
    'get_workspace',
    'Inspect the current design project, IDs, settings, poses and editable layers. Image bytes are omitted unless includeImages is true.',
    z.strictObject({ workspace: mode, includeImages: z.boolean().default(false) }),
    true,
  ],
  [
    'create_project',
    'Create an empty project in the live editor. The previous project remains in Undo history. Only the edit workspace is opened.',
    z.strictObject({ workspace: mode, name: z.string().min(1).max(100) }),
    false,
  ],
  [
    'load_project',
    'Load a native Skarix project JSON object into its live edit workspace. Validation and Undo apply; this never opens printing or cutter controls.',
    z.strictObject({ workspace: mode, project: z.record(z.string(), z.unknown()) }),
    false,
  ],
  [
    'update_project_settings',
    'Change physical layout settings, artwork fit, border and paper. All distances are millimeters. No printer or machine operation is performed.',
    z.strictObject({
      workspace: mode,
      settings: z.strictObject({
        width: z.number().optional(),
        height: z.number().optional(),
        gap: z.number().optional(),
        radius: z.number().optional(),
        paper: z.enum(['letter', 'a4']).optional(),
        machine: z.enum(['maker', 'explore', 'explore-5', 'joy-xtra', 'manual']).optional(),
        layout: z.enum(['grid', 'tapered']).optional(),
        areaWidth: z.number().optional(),
        areaHeight: z.number().optional(),
        fit: z.enum(['contain', 'cover']).optional(),
        borderWidth: z.number().optional(),
        borderStrokeWidth: z.number().optional(),
        borderStrokeColor: color.optional(),
        dpi: z.enum([300, 600, 900, 1200]).optional(),
      }),
    }),
    false,
  ],
  [
    'create_design',
    'Create an editable design. Use up to 500 layered shapes/text/images/drawn paths for detailed artwork. Shapes support gradient: {from, to} hex colors for a left-to-right fill. Returns the design ID.',
    z.strictObject({
      workspace: mode,
      name: z.string().min(1).max(100),
      canvas: canvas.optional(),
      elements: z.array(element).max(500).optional(),
      copies: z.number().int().min(0).max(100).default(1),
    }),
    false,
  ],
  [
    'edit_design',
    'Atomically edit layers in an existing design. Bottom-to-top layer order; draw.points are normalized 0..1 inside the element box. Closed drawn paths may have fills. Appearance supports advanced gradient stops, effects, blendMode, texture, mask and image adjustments. Set optional appearance objects to null to clear. Draw curves use normalized c1/c2/end cubic segments starting at points[0]. Group/ungroup operations manage artwork hierarchies; group children use local coordinates. Groups resize against groupWidth/groupHeight. Keep cuts outside groups. Text supports textPath {pathId,side:inner|middle|outer,offset:0..100} referencing a shape or closed drawn path. hidden omits a layer from output; locked protects edits until unlocked. align supports edges, centers and center-to-center distribution. Canvas grid controls are non-printing; MCP coordinates remain exact. Updating an element supports all style and transform properties; cut operation only edits blade geometry, never runs it.',
    z.strictObject({
      workspace: mode,
      designId: id,
      name: z.string().min(1).max(100).optional(),
      canvas: canvas.optional(),
      operations: z
        .array(
          z.discriminatedUnion('action', [
            z.strictObject({ action: z.literal('add'), element }),
            z.strictObject({ action: z.literal('update'), id, patch: element }),
            z.strictObject({ action: z.literal('remove'), id }),
            z.strictObject({
              action: z.literal('group'),
              ids: z.array(id).min(2).max(500),
              id: id.optional(),
            }),
            z.strictObject({ action: z.literal('ungroup'), id }),
            z.strictObject({
              action: z.literal('align'),
              ids: z.array(id).min(2).max(500),
              alignment: z.enum([
                'left',
                'center',
                'right',
                'top',
                'middle',
                'bottom',
                'distribute-horizontal',
                'distribute-vertical',
              ]),
            }),
            z.strictObject({
              action: z.literal('duplicate'),
              id,
              newId: id.optional(),
              dx: z.number().min(-500).max(500).default(1),
              dy: z.number().min(-500).max(500).default(1),
            }),
            z.strictObject({
              action: z.literal('apply_material'),
              ids: z.array(id).min(1).max(500),
              presetId: id,
              includeDescendants: z.boolean().default(false),
            }),
            z.strictObject({
              action: z.literal('save_material'),
              id,
              name: z.string().min(1).max(100),
            }),
            z.strictObject({ action: z.literal('reorder'), ids: z.array(id).max(500) }),
          ]),
        )
        .max(100),
    }),
    false,
  ],
  [
    'fit_design_cut',
    'Fit a sticker cut boundary around printed artwork with optional border padding and printed stroke. Edits geometry only; never connects or cuts.',
    z.strictObject({
      workspace: z.literal('stickers'),
      designId: id,
      borderWidth: z.number().min(0).max(20).default(1),
      strokeWidth: z.number().min(0).max(5).default(0),
      strokeColor: color.default('#222222'),
      strokePlacement: z.enum(['inside', 'centered', 'outside']).default('inside'),
    }),
    false,
  ],
  [
    'import_artwork',
    'Import embedded PNG/JPEG/WebP or a sanitized plain SVG as a design. No file paths, network fetches or executable SVG are accepted.',
    z
      .strictObject({
        workspace: mode,
        name: z.string().min(1).max(100),
        image: raster.optional(),
        svg: z.string().max(5_000_000).optional(),
        copies: z.number().int().min(0).max(100).default(1),
      })
      .refine((v) => !!v.image !== !!v.svg, 'Provide image OR svg.'),
    false,
  ],
  [
    'edit_sticker_items',
    'Add copies of a design, transform/delete/duplicate one placed sticker by zero-based index. All distances are millimeters. Actions are atomic and undoable.',
    z.strictObject({
      action: z.enum(['add', 'transform', 'delete', 'duplicate']),
      designId: id.optional(),
      index: z.number().int().min(0).max(499).optional(),
      copies: z.number().int().min(1).max(100).default(1),
      pose: pose.optional(),
    }),
    false,
  ],
  [
    'arrange_stickers',
    'Auto-arrange all stickers or fill with a chosen design, using the existing bounded nesting worker and machine keep-out geometry.',
    z.strictObject({ action: z.enum(['arrange', 'fill']), designId: id.optional() }),
    false,
  ],
  [
    'preview_design',
    'Return a PNG image for visual review of one design or a whole sheet. showCuts draws a preview-only dashed outline. Does not prepare a print job.',
    z.strictObject({
      workspace: mode,
      designId: id.optional(),
      layerId: id.optional(),
      sheet: z.number().int().min(0).max(23).default(0),
      showCuts: z.boolean().default(false),
      maxPixels: z.number().int().min(256).max(2048).default(1200),
    }),
    true,
  ],
  [
    'export_project',
    'Return the native project JSON for local saving by the MCP client. No disk writes, print PDF, spooler or cutter job is created.',
    z.strictObject({ workspace: mode }),
    true,
  ],
  [
    'workspace_history',
    'Undo or redo the most recent design operation in a workspace.',
    z.strictObject({ workspace: mode, action: z.enum(['undo', 'redo']) }),
    false,
  ],
];
const DESIGN_TOOLS = tools.map(([name, description, schema, readOnly]) => ({
  name,
  description,
  schema,
  readOnly,
}));
function designTool(name) {
  const tool = DESIGN_TOOLS.find((t) => t.name === name);
  if (!tool)
    throw Error(
      'Unknown design tool. Printing, cutter control and arbitrary commands are not available.',
    );
  return tool;
}
module.exports = { DESIGN_TOOLS, designTool };
