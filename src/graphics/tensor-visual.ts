import { structurePalette, type ViewTheme } from './view-theme.ts';
import type { NodeEntity, Params, Point, ProjectDocument } from '../core/document/types.ts';
import { tensorKind, type AnalysisEntry, type AnalysisReport } from '../core/computation/index.ts';
import type { Bounds, Primitive } from './primitives.ts';
import { buildBlockGeometry } from './block-geometry.ts';
import { nodeVisual } from './paint.ts';

type Mode = 'structure' | 'figure';
type Visual = { bounds: Bounds; primitives: Primitive[]; ports: Record<string, Point> };
const foreground = (mode: Mode, theme: ViewTheme) =>
  mode === 'structure' ? structurePalette(theme).text : '#253342';
const secondary = (mode: Mode, theme: ViewTheme) =>
  mode === 'structure' ? structurePalette(theme).muted : '#536574';
const text = (
  value: string,
  x: number,
  y: number,
  width: number,
  color: string,
  height = 20,
): Primitive => ({ kind: 'text', text: value, x, y, width, height, fontSize: 14, color });
const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  opacity?: number,
): Primitive => ({
  kind: 'rect',
  x,
  y,
  width,
  height,
  fill,
  stroke,
  strokeWidth: 1.2,
  ...(opacity === undefined ? {} : { opacity }),
});

/** Both workspaces paint the same semantic objects; the analysis is never saved as a second model. */
export function tensorVisual(
  doc: ProjectDocument,
  node: NodeEntity,
  report: AnalysisReport,
  mode: Mode,
  theme: ViewTheme = 'dark',
): Visual {
  const kind = tensorKind(node);
  if (!kind || node.generation?.version !== '1.0.0' || node.generation.paramSchemaVersion !== 1)
    return snapshotVisual(doc, node, mode, theme);
  const operation = node.semantic?.role === 'operation',
    entry = report.nodes[node.id],
    params = node.generation?.source.kind === 'local' ? node.generation.source.params : {};
  const visual = operation
    ? operationVisual(doc, node, kind ?? '', params, entry, mode, theme)
    : dataVisual(doc, node, entry, mode, theme);
  if (mode === 'figure')
    for (const p of visual.primitives) {
      if (node.presentation.opacityOverride !== undefined)
        p.opacity = node.presentation.opacityOverride;
      const color = node.presentation.textOverride ?? doc.theme.textColor;
      if (p.kind === 'text' && color) p.color = color;
    }
  return visual;
}

/** An unavailable generator is a stored drawing, not permission to render a newer rule. */
function snapshotVisual(
  doc: ProjectDocument,
  node: NodeEntity,
  mode: Mode,
  theme: ViewTheme,
): Visual {
  const snapshot = nodeVisual(node),
    message = '推导规则未知',
    width = Math.max(snapshot.bounds.width, estimatedTextWidth(message)),
    x = snapshot.bounds.x + (snapshot.bounds.width - width) / 2;
  snapshot.primitives.push(
    text(
      message,
      x,
      snapshot.bounds.y + snapshot.bounds.height + 8,
      width,
      mode === 'structure'
        ? foreground(mode, theme)
        : (node.presentation.textOverride ?? doc.theme.textColor ?? secondary(mode, theme)),
    ),
  );
  return {
    bounds: boundsOf(snapshot.primitives),
    primitives: snapshot.primitives,
    ports: savedPorts(node),
  };
}

function dataVisual(
  doc: ProjectDocument,
  node: NodeEntity,
  entry: AnalysisEntry | undefined,
  mode: Mode,
  theme: ViewTheme = 'dark',
): Visual {
  const generated = nodeVisual({
      ...node,
      presentation: { ...node.presentation, labelOverride: undefined },
    }),
    front = (mode === 'structure' ? node.primitives : generated.primitives).find(
      (p) => p.kind === 'rect',
    ),
    fill = front?.kind === 'rect' ? front.fill : (doc.theme.nodeColor ?? '#a6bdce'),
    width = mode === 'structure' ? 104 : node.size.width,
    height = mode === 'structure' ? 88 : node.size.height,
    projected =
      mode === 'structure'
        ? buildBlockGeometry(
            { width, height },
            { mode: 'axonometric', depth: 28, stackCount: 1, stackGap: 0, angleDeg: 30 },
            { fill, stroke: '#8da8b9', strokeWidth: 1.2 },
          )
        : undefined;
  const primitives = projected?.ok
    ? projected.value.primitives
    : generated.primitives.filter((p) => p.kind !== 'text');
  const title = node.presentation.labelOverride ?? node.name,
    labelColor =
      mode === 'figure'
        ? (node.presentation.textOverride ?? foreground(mode, theme))
        : foreground(mode, theme);
  const lines = title.replace(/\r\n?/g, '\n').split('\n');
  const labels = shapeLabels(entry),
    labelWidth = Math.max(
      width,
      168,
      ...lines.map(estimatedTextWidth),
      ...labels.map(estimatedTextWidth),
    ),
    labelX = (width - labelWidth) / 2,
    labelY = height + 10;
  lines.forEach((line, i) =>
    primitives.push(text(line, labelX, labelY + i * 22, labelWidth, labelColor)),
  );
  labels.forEach((line, i) =>
    primitives.push(
      text(
        line,
        labelX,
        labelY + (lines.length + i) * 22,
        labelWidth,
        entry?.state === 'error'
          ? mode === 'structure'
            ? '#e6a89d'
            : '#a44137'
          : secondary(mode, theme),
      ),
    ),
  );
  const ports =
    mode === 'structure' ? positionPorts(node, width + 24.25, height, 0, -7) : savedPorts(node);
  return { bounds: boundsOf(primitives), primitives, ports };
}

function shapeLabels(entry: AnalysisEntry | undefined): string[] {
  if (!entry || entry.state === 'pending') return ['待配置'];
  if (entry.state === 'error') return ['尺寸冲突'];
  if (entry.state === 'unsupported') return ['推导规则未知'];
  if (!entry.shape) return ['规格未知'];
  const { N, D, H, W, C } = entry.shape;
  const dimension = (value: number | null | undefined) => (value === null ? '?' : String(value));
  return [
    `${D === undefined ? '' : `${dimension(D)}×`}${dimension(H)}×${dimension(W)}`,
    `${N !== 1 ? `N${dimension(N)} · ` : ''}C${dimension(C)}`,
  ];
}

function operationVisual(
  doc: ProjectDocument,
  node: NodeEntity,
  kind: string,
  params: Params,
  entry: AnalysisEntry | undefined,
  mode: Mode,
  theme: ViewTheme = 'dark',
): Visual {
  const width = mode === 'structure' ? 84 : node.size.width,
    height = mode === 'structure' ? 44 : node.size.height,
    sx = width / 84,
    sy = height / 44,
    line =
      mode === 'structure' ? structurePalette(theme).border : (doc.theme.borderColor ?? '#536574'),
    blue = '#a7c8d9',
    red = '#d99a94',
    primitives: Primitive[] = [];
  const box = (x: number, y: number, w: number, h: number, fill: string, opacity?: number) =>
    primitives.push(rect(x * sx, y * sy, w * sx, h * sy, fill, line, opacity));
  const polygon = (points: Point[], fill: string, opacity?: number) =>
    primitives.push({
      kind: 'polygon',
      points: points.map((p) => ({ x: p.x * sx, y: p.y * sy })),
      fill,
      stroke: line,
      strokeWidth: 1.2,
      ...(opacity === undefined ? {} : { opacity }),
    });
  let label = node.name;
  if (kind === 'conv3d' || kind === 'conv2d') {
    // One local receptive field and a short mapping, not the full tensor or the full computation.
    box(5, 10, 23, 24, blue, 0.7);
    polygon(
      [
        { x: 5, y: 10 },
        { x: 13, y: 4 },
        { x: 36, y: 4 },
        { x: 28, y: 10 },
      ],
      blue,
      0.7,
    );
    polygon(
      [
        { x: 28, y: 10 },
        { x: 36, y: 4 },
        { x: 36, y: 28 },
        { x: 28, y: 34 },
      ],
      blue,
      0.7,
    );
    polygon(
      [
        { x: 36, y: 9 },
        { x: 69, y: 19 },
        { x: 69, y: 25 },
        { x: 36, y: 31 },
      ],
      red,
      0.55,
    );
    box(69, 17, 7, 10, red, 0.9);
    label = kind === 'conv2d' ? 'Conv2D' : 'Conv3D';
  } else if (kind === 'pool3d' || kind === 'pool2d') {
    // Four samples aggregate to one result; unlike Conv, this glyph has no learned mapping volume.
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++) box(7 + col * 13, 8 + row * 13, 11, 11, blue, 0.7);
    polygon(
      [
        { x: 42, y: 21 },
        { x: 54, y: 21 },
        { x: 54, y: 17 },
        { x: 61, y: 23 },
        { x: 54, y: 29 },
        { x: 54, y: 25 },
        { x: 42, y: 25 },
      ],
      line,
    );
    box(65, 17, 11, 11, '#b6b1cd');
    label = kind === 'pool2d' ? 'Pool2D' : 'Pool3D';
  } else if (kind === 'relu') {
    polygon(
      [
        { x: 10, y: 30 },
        { x: 38, y: 30 },
        { x: 70, y: 4 },
        { x: 70, y: 7 },
        { x: 39, y: 33 },
        { x: 10, y: 33 },
      ],
      line,
    );
    label = 'ReLU';
  } else if (kind === 'upsample') {
    box(8, 17, 12, 12, blue);
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) box(50 + x * 12, 8 + y * 12, 10, 10, blue);
    polygon(
      [
        { x: 26, y: 21 },
        { x: 38, y: 21 },
        { x: 38, y: 16 },
        { x: 46, y: 23 },
        { x: 38, y: 30 },
        { x: 38, y: 25 },
        { x: 26, y: 25 },
      ],
      line,
    );
    label = 'Upsample';
  } else if (kind === 'concat') {
    box(13, 5, 15, 15, blue, 0.8);
    box(13, 25, 15, 15, '#b7be9f', 0.8);
    box(46, 8, 12, 28, blue, 0.85);
    box(58, 8, 12, 28, '#b7be9f', 0.85);
    polygon(
      [
        { x: 31, y: 20 },
        { x: 38, y: 20 },
        { x: 38, y: 16 },
        { x: 44, y: 22 },
        { x: 38, y: 28 },
        { x: 38, y: 24 },
        { x: 31, y: 24 },
      ],
      line,
    );
    label = `Concat · ${typeof params.axis === 'string' ? params.axis : '?'}`;
  } else if (kind === 'add') {
    primitives.push({
      kind: 'ellipse',
      x: 25 * sx,
      y: 5 * sy,
      width: 34 * sx,
      height: 34 * sy,
      fill: mode === 'structure' ? '#23382f' : '#e5eee8',
      stroke: line,
      strokeWidth: 1.2,
    });
    primitives.push(text('⊕', 25 * sx, 5 * sy, 34 * sx, foreground(mode, theme), 34 * sy));
    label = 'Add';
  } else {
    box(25, 7, 34, 30, blue, 0.7);
  }
  // Presentation overrides affect the operation independently of its real parameters.
  for (const p of mode === 'figure' ? primitives : []) {
    if ('fill' in p) {
      if (node.presentation.fillOverride) p.fill = node.presentation.fillOverride;
      if (node.presentation.strokeOverride) p.stroke = node.presentation.strokeOverride;
      if (node.presentation.strokeWidthOverride !== undefined)
        p.strokeWidth = node.presentation.strokeWidthOverride;
    }
    if (node.presentation.opacityOverride !== undefined)
      p.opacity = node.presentation.opacityOverride;
  }
  const name = node.presentation.labelOverride ?? label,
    detail = operationDetail(kind, params),
    labelWidth = Math.max(width, estimatedTextWidth(name), estimatedTextWidth(detail)),
    x = (width - labelWidth) / 2,
    color =
      mode === 'figure'
        ? (node.presentation.textOverride ?? foreground(mode, theme))
        : foreground(mode, theme);
  const lines = name.replace(/\r\n?/g, '\n').split('\n');
  let labelY = height + 5;
  for (const line of lines) {
    primitives.push(text(line, x, labelY, labelWidth, color));
    labelY += 22;
  }
  if (detail) {
    primitives.push(text(detail, x, labelY, labelWidth, secondary(mode, theme)));
    labelY += 22;
  }
  if (entry && entry.state !== 'ready')
    primitives.push(
      text(
        entry.state === 'error'
          ? '尺寸冲突'
          : entry.state === 'unsupported'
            ? '推导规则未知'
            : '待配置',
        x,
        labelY,
        labelWidth,
        mode === 'structure' ? '#e6a89d' : '#a44137',
      ),
    );
  return { bounds: boundsOf(primitives), primitives, ports: positionPorts(node, width, height) };
}

function operationDetail(kind: string, params: Params): string {
  if (kind === 'upsample')
    return `×${['D', 'H', 'W']
      .filter((a) => a !== 'D' || params.dimension !== 2)
      .map((a) => params[`scale${a}`] ?? '?')
      .join('×')}`;
  if (!['conv3d', 'conv2d', 'pool3d', 'pool2d'].includes(kind)) return '';
  const axes = (prefix: string, cube: boolean) => {
    const values = (kind.endsWith('2d') ? ['H', 'W'] : ['D', 'H', 'W']).map(
      (axis) => params[`${prefix}${axis}`],
    );
    if (values.every((value) => typeof value === 'number') && new Set(values).size === 1)
      return `${values[0]}${cube ? (kind.endsWith('2d') ? '²' : '³') : ''}`;
    return values.map((value) => (typeof value === 'number' ? value : '?')).join('×');
  };
  return `k${axes('kernel', true)} · s${axes('stride', false)}`;
}
function positionPorts(
  node: NodeEntity,
  width: number,
  height: number,
  inOffset = 0,
  outOffset = 0,
): Record<string, Point> {
  const keys = Object.keys(node.ports),
    inputs = keys.filter((k) => !/^out\d*$/.test(k)),
    outputs = keys.filter((k) => /^out\d*$/.test(k));
  return Object.fromEntries(
    keys.map((key) => {
      const isOutput = outputs.includes(key),
        side = isOutput ? outputs : inputs;
      return [
        key,
        {
          x: isOutput ? width : inOffset,
          y: (height * (side.indexOf(key) + 1)) / (side.length + 1) + (isOutput ? outOffset : 0),
        },
      ];
    }),
  );
}
function savedPorts(node: NodeEntity): Record<string, Point> {
  return Object.fromEntries(
    Object.entries(node.ports)
      .filter((entry): entry is [string, Point] => 'x' in entry[1])
      .map(([id, point]) => [id, { ...point }]),
  );
}
function estimatedTextWidth(value: string): number {
  return (
    Math.max(
      1,
      ...value
        .split('\n')
        .map((line) =>
          Array.from(line).reduce((width, char) => width + (/[^\x00-\x7f]/.test(char) ? 14 : 8), 0),
        ),
    ) + 8
  );
}
function boundsOf(primitives: Primitive[]): Bounds {
  const points = primitives.flatMap((p) =>
      p.kind === 'polygon'
        ? p.points
        : [
            { x: p.x, y: p.y },
            { x: p.x + p.width, y: p.y + p.height },
          ],
    ),
    x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
