import { structurePalette, type ViewTheme } from './view-theme.ts';
import type { NodeEntity, Point, ProjectDocument } from '../core/document/types.ts';
import {
  resolveComputation,
  type ComputationRegistry,
  type AnalysisEntry,
  type AnalysisReport,
} from '../core/computation/index.ts';
import { semanticTarget } from '../core/figure/index.ts';
import type { Bounds, Primitive } from './primitives.ts';
import { buildBlockGeometry } from './block-geometry.ts';
import { nodeVisual } from './paint.ts';
import {
  automaticTensorDisplay,
  hasTensorGridSnapshot,
  manualTensorGridGeometry,
  tensorGridGeometry,
} from './tensor-grid.ts';

type Mode = 'structure' | 'figure';
type Visual = {
  bounds: Bounds;
  primitives: Primitive[];
  ports: Record<string, Point>;
  /** Selection-only structure label; never part of a saved drawing or its geometry. */
  caption?: string;
};
const structureCaption = (node: NodeEntity) =>
  (node.presentation.labelOverride ?? node.name).replace(/\s+/g, ' ').trim();
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
  computations?: ComputationRegistry,
): Visual {
  const source = semanticTarget(doc, node.id) ?? (node.semantic ? node : undefined),
    definition = source && resolveComputation(source, computations);
  if (!source || !definition) return snapshotVisual(doc, node, mode, theme);
  const display =
      source === node
        ? node
        : { ...node, name: source.name, semantic: source.semantic, generation: source.generation },
    operation = source.semantic?.role === 'operation',
    entry = report.nodes[source.id],
    params = source.generation?.source.kind === 'local' ? source.generation.source.params : {};
  const visual = operation
    ? operationVisual(
        doc,
        display,
        {
          glyph: definition.presentation?.glyph ?? '',
          label: definition.presentation?.label?.(params) ?? display.name,
          detail: definition.presentation?.detail?.(params) ?? '',
          outputPort: definition.outputPort,
        },
        entry,
        mode,
        theme,
      )
    : dataVisual(doc, display, entry, mode, theme, definition.outputPort);
  if (mode === 'figure')
    for (const p of visual.primitives) {
      if (node.presentation.opacityOverride !== undefined)
        p.opacity = node.presentation.opacityOverride;
      const color = node.presentation.textOverride ?? doc.theme.textColor;
      if (p.kind === 'text' && color) p.color = color;
    }
  return visual;
}

function gridDataVisual(
  doc: ProjectDocument,
  node: NodeEntity,
  entry: AnalysisEntry | undefined,
  theme: ViewTheme,
  outputPort: string,
): Visual {
  const params = node.generation?.source,
    front = node.primitives.find((p) => p.kind === 'rect'),
    fill = front?.kind === 'rect' ? front.fill : (doc.theme.nodeColor ?? '#a6bdce'),
    grid =
      entry?.state === 'ready' && params?.kind === 'local'
        ? tensorGridGeometry(entry.shape, params.params, {
            fill,
            stroke: '#8da8b9',
            strokeWidth: 1,
          })
        : undefined,
    primitives: Primitive[] = grid?.ok
      ? [...grid.value.primitives]
      : [rect(0, 0, 104, 72, structurePalette(theme).surface, '#8da8b9')],
    width = grid?.ok ? grid.value.size.width : 104,
    height = grid?.ok ? grid.value.size.height : 72,
    depth = grid?.ok ? grid.value.depth : 0;
  const ports = positionPorts(
    node,
    width + depth * Math.cos(Math.PI / 6),
    height,
    outputPort,
    0,
    -depth / 4,
  );
  return { primitives, bounds: boundsOf(primitives), ports, caption: structureCaption(node) };
}

/** The source is persisted, while computed annotation text is derived at projection time. */
export function annotationVisual(
  doc: ProjectDocument,
  node: NodeEntity,
  report: AnalysisReport,
): Visual {
  const annotation = node.annotation;
  let value = annotation?.kind === 'manual' ? annotation.text : '';
  if (annotation?.kind === 'derived') {
    const source = semanticTarget(doc, annotation.semanticRef),
      entry = report.nodes[annotation.semanticRef];
    if (annotation.field === 'name') value = source?.name ?? '来源不可用';
    else if (annotation.field === 'parameters') {
      const params = source?.generation?.source;
      value =
        params?.kind === 'local'
          ? Object.entries(params.params)
              .map(([key, item]) => `${key}=${JSON.stringify(item)}`)
              .join(' · ')
          : '参数不可用';
    } else
      value =
        entry?.state === 'ready' && entry.shape
          ? Object.entries(entry.shape)
              .map(([axis, size]) => `${axis}${size ?? '?'}`)
              .join(' · ')
          : entry?.state === 'error'
            ? '尺寸冲突'
            : entry?.state === 'unsupported'
              ? '推导规则未知'
              : '待配置';
  }
  const lines = value.replace(/\r\n?/g, '\n').split('\n'),
    width = Math.max(node.size.width, ...lines.map(estimatedTextWidth)),
    color = node.presentation.textOverride ?? doc.theme.textColor ?? '#26333d';
  const primitives = lines.map(
    (line, index): Primitive => ({
      kind: 'text',
      text: line,
      x: 0,
      y: index * 24,
      width,
      height: 24,
      fontSize: 14,
      color,
      ...(node.presentation.opacityOverride !== undefined
        ? { opacity: node.presentation.opacityOverride }
        : {}),
    }),
  );
  return {
    primitives,
    bounds: { x: 0, y: 0, width, height: Math.max(24, lines.length * 24) },
    ports: {},
  };
}

/** An unavailable generator is a stored drawing, not permission to render a newer rule. */
function snapshotVisual(
  doc: ProjectDocument,
  node: NodeEntity,
  mode: Mode,
  theme: ViewTheme,
): Visual {
  const snapshot = nodeVisual(node);
  if (mode === 'structure') {
    const primitives: Primitive[] = snapshot.primitives.filter(
      (primitive) => primitive.kind !== 'text',
    );
    if (!primitives.length)
      primitives.push(
        rect(
          0,
          0,
          node.size.width,
          node.size.height,
          structurePalette(theme).surface,
          structurePalette(theme).border,
        ),
      );
    return {
      bounds: boundsOf(primitives),
      primitives,
      ports: savedPorts(node),
      caption: structureCaption(node),
    };
  }
  const message = '推导规则未知',
    width = Math.max(snapshot.bounds.width, estimatedTextWidth(message)),
    x = snapshot.bounds.x + (snapshot.bounds.width - width) / 2;
  snapshot.primitives.push(
    text(
      message,
      x,
      snapshot.bounds.y + snapshot.bounds.height + 8,
      width,
      node.presentation.textOverride ?? doc.theme.textColor ?? secondary(mode, theme),
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
  outputPort = 'out',
): Visual {
  const params = node.generation?.source;
  if (mode === 'structure' && params?.kind === 'local' && automaticTensorDisplay(params.params))
    return gridDataVisual(doc, node, entry, theme, outputPort);
  const generated = nodeVisual({
      ...node,
      presentation: { ...node.presentation, labelOverride: undefined },
    }),
    front = (mode === 'structure' ? node.primitives : generated.primitives).find(
      (p) => p.kind === 'rect',
    ),
    fill = front?.kind === 'rect' ? front.fill : (doc.theme.nodeColor ?? '#a6bdce'),
    manual = params?.kind === 'local' && params.params.displayMode === 'manual',
    width = mode === 'structure' && !manual ? 104 : node.size.width,
    height = mode === 'structure' && !manual ? 88 : node.size.height,
    depth =
      manual &&
      params?.kind === 'local' &&
      typeof params.params.depth === 'number' &&
      Number.isFinite(params.params.depth) &&
      params.params.depth >= 0 &&
      params.params.depth <= 200
        ? params.params.depth
        : 28,
    angle =
      manual &&
      params?.kind === 'local' &&
      typeof params.params.angleDeg === 'number' &&
      Number.isFinite(params.params.angleDeg) &&
      params.params.angleDeg >= 0 &&
      params.params.angleDeg <= 80
        ? params.params.angleDeg
        : 30,
    projected =
      mode === 'structure'
        ? manual && entry?.state === 'ready'
          ? manualTensorGridGeometry(entry.shape, { width, height }, depth, angle, {
              fill,
              stroke: '#8da8b9',
              strokeWidth: 1.2,
            })
          : buildBlockGeometry(
              { width, height },
              { mode: 'axonometric', depth, stackCount: 1, stackGap: 0, angleDeg: angle },
              { fill, stroke: '#8da8b9', strokeWidth: 1.2 },
            )
        : undefined;
  const primitives = projected?.ok
    ? projected.value.primitives
    : generated.primitives.filter((p) => p.kind !== 'text');
  if (mode === 'structure')
    return {
      bounds: boundsOf(primitives),
      primitives,
      ports: positionPorts(
        node,
        width + depth * Math.cos((angle * Math.PI) / 180),
        height,
        outputPort,
        0,
        (-depth * Math.sin((angle * Math.PI) / 180)) / 2,
      ),
      caption: structureCaption(node),
    };
  const title = node.presentation.labelOverride ?? node.name,
    labelColor = node.presentation.textOverride ?? foreground(mode, theme);
  const lines = title.replace(/\r\n?/g, '\n').split('\n');
  const labels = [
      ...(hasTensorGridSnapshot(node) && entry?.state === 'ready' && entry.shape
        ? [
            `W ${entry.shape.W} · H ${entry.shape.H} · ${entry.shape.D === undefined ? `C ${entry.shape.C}` : `D ${entry.shape.D}`}`,
            `N ${entry.shape.N}${entry.shape.D === undefined ? '' : ` · C ${entry.shape.C}`}`,
          ]
        : shapeLabels(entry)),
      ...(node.primitives.some(
        (primitive) => primitive.kind === 'text' && primitive.text === '压缩示意',
      )
        ? ['压缩示意']
        : []),
    ],
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
        entry?.state === 'error' ? '#a44137' : secondary(mode, theme),
      ),
    ),
  );
  return { bounds: boundsOf(primitives), primitives, ports: savedPorts(node) };
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
  appearance: { glyph: string; label: string; detail: string; outputPort: string },
  entry: AnalysisEntry | undefined,
  mode: Mode,
  theme: ViewTheme = 'dark',
): Visual {
  const { glyph: kind, detail, outputPort } = appearance;
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
  if (mode === 'structure')
    return {
      bounds: boundsOf(primitives),
      primitives,
      ports: positionPorts(node, width, height, outputPort),
      caption: structureCaption(node),
    };
  const name = node.presentation.labelOverride ?? appearance.label,
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
        '#a44137',
      ),
    );
  return {
    bounds: boundsOf(primitives),
    primitives,
    ports: positionPorts(node, width, height, outputPort),
  };
}

function positionPorts(
  node: NodeEntity,
  width: number,
  height: number,
  outputPort: string,
  inOffset = 0,
  outOffset = 0,
): Record<string, Point> {
  const keys = Object.keys(node.ports),
    inputs = keys.filter((key) => key !== outputPort),
    outputs = keys.filter((key) => key === outputPort);
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
