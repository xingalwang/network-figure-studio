import type { TensorShape, ComputationRegistry } from '../core/computation/index.ts';
import { analyzeDocument } from '../core/computation/index.ts';
import type {
  NodeEntity,
  Params,
  Point,
  ProjectDocument,
  ResolvedOperation,
  Result,
} from '../core/document/types.ts';
import { fail, ok } from '../core/document/types.ts';
import { semanticTarget } from '../core/figure/index.ts';
import { buildBlockGeometry, type BlockOptions } from './block-geometry.ts';
import type { BlockGeometry, Primitive } from './primitives.ts';

export const TENSOR_GRID_LIMIT = 12;
const UNIT = 2,
  LINEAR_LIMIT = 128,
  DISPLAY_LIMIT = 192;
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const multiplier = (value: unknown): number =>
  positive(value) && value >= 0.25 && value <= 4 ? value : 1;
export const automaticTensorDisplay = (params: Readonly<Params>): boolean =>
  params.displayMode === 'auto';
export const hasTensorGridSnapshot = (node: NodeEntity): boolean =>
  node.primitives.some(
    (primitive) =>
      primitive.kind === 'polygon' && primitive.strokeWidth === 0 && primitive.opacity === 0.55,
  );

/** Every tensor uses this same mapping; large extents are explicitly marked as compressed. */
function displayLength(value: number): number {
  if (value <= LINEAR_LIMIT) return value;
  const extra = value - LINEAR_LIMIT,
    span = DISPLAY_LIMIT - LINEAR_LIMIT;
  return LINEAR_LIMIT + span * (extra / (span + extra));
}

type Segments = { width: number; height: number; depth: number };
export type TensorGrid = BlockGeometry & {
  size: { width: number; height: number };
  depth: number;
  compressed: boolean;
  simplified: boolean;
  depthAxis: 'C' | 'D';
};

function gridLine(a: Point, b: Point, color: string): Primitive {
  const length = Math.hypot(b.x - a.x, b.y - a.y),
    nx = length ? (-(b.y - a.y) * 0.3) / length : 0,
    ny = length ? ((b.x - a.x) * 0.3) / length : 0;
  return {
    kind: 'polygon',
    points: [
      { x: a.x + nx, y: a.y + ny },
      { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny },
      { x: a.x - nx, y: a.y - ny },
    ],
    fill: color,
    stroke: color,
    strokeWidth: 0,
    opacity: 0.55,
  };
}

function buildGrid(
  size: { width: number; height: number },
  depth: number,
  angleDeg: number,
  segments: Segments,
  options: BlockOptions,
): Result<BlockGeometry> {
  const generated = buildBlockGeometry(
    size,
    { mode: 'axonometric', depth, angleDeg, stackCount: 1, stackGap: 0 },
    options,
  );
  if (!generated.ok) return generated;
  const geometry = generated.value,
    { width: w, height: h } = size,
    radians = (angleDeg * Math.PI) / 180,
    dx = depth * Math.cos(radians),
    dy = depth * Math.sin(radians),
    color = options.stroke ?? '#637486',
    line = (a: Point, b: Point) => geometry.primitives.push(gridLine(a, b, color));
  for (let i = 1; i < segments.width; i++)
    line({ x: (w * i) / segments.width, y: 0 }, { x: (w * i) / segments.width, y: h });
  for (let i = 1; i < segments.height; i++)
    line({ x: 0, y: (h * i) / segments.height }, { x: w, y: (h * i) / segments.height });
  if (depth > 0) {
    for (let i = 1; i < segments.width; i++)
      line({ x: (w * i) / segments.width, y: 0 }, { x: (w * i) / segments.width + dx, y: -dy });
    for (let i = 1; i < segments.depth; i++)
      line(
        { x: (dx * i) / segments.depth, y: (-dy * i) / segments.depth },
        { x: w + (dx * i) / segments.depth, y: (-dy * i) / segments.depth },
      );
    for (let i = 1; i < segments.height; i++)
      line(
        { x: w, y: (h * i) / segments.height },
        { x: w + dx, y: (h * i) / segments.height - dy },
      );
    for (let i = 1; i < segments.depth; i++)
      line(
        { x: w + (dx * i) / segments.depth, y: (-dy * i) / segments.depth },
        { x: w + (dx * i) / segments.depth, y: h - (dy * i) / segments.depth },
      );
  }
  for (const primitive of geometry.primitives) {
    if (primitive.kind !== 'polygon') continue;
    for (const point of primitive.points) {
      const right = Math.max(geometry.bounds.x + geometry.bounds.width, point.x),
        bottom = Math.max(geometry.bounds.y + geometry.bounds.height, point.y);
      geometry.bounds.x = Math.min(geometry.bounds.x, point.x);
      geometry.bounds.y = Math.min(geometry.bounds.y, point.y);
      geometry.bounds.width = right - geometry.bounds.x;
      geometry.bounds.height = bottom - geometry.bounds.y;
    }
  }
  return ok(geometry);
}

export function tensorGridGeometry(
  shape: TensorShape | undefined,
  params: Readonly<Params>,
  options: BlockOptions = {},
): Result<TensorGrid> {
  const depthAxis = shape?.D === undefined ? 'C' : 'D',
    values = [shape?.W, shape?.H, shape?.[depthAxis]];
  if (!values.every(positive))
    return fail('TENSOR_SIZE_PENDING', '尺寸尚未确定，暂不按真实规格绘制网格。');
  const scale = multiplier(params.displayScale),
    factors = [
      multiplier(params.displayW),
      multiplier(params.displayH),
      multiplier(params[`display${depthAxis}`]),
    ],
    raw = (values as number[]).map((value, index) => value * UNIT * scale * factors[index]),
    lengths = raw.map(displayLength),
    size = { width: lengths[0], height: lengths[1] },
    depth = lengths[2],
    segments = (values as number[]).map((value) =>
      Math.min(TENSOR_GRID_LIMIT, Math.max(1, Math.floor(value))),
    ),
    generated = buildGrid(
      size,
      depth,
      30,
      { width: segments[0], height: segments[1], depth: segments[2] },
      options,
    );
  return generated.ok
    ? ok({
        ...generated.value,
        size,
        depth,
        depthAxis,
        compressed: raw.some((value) => value > LINEAR_LIMIT),
        simplified: (values as number[]).some((value) => value > TENSOR_GRID_LIMIT),
      })
    : generated;
}

/** Manual extents change the drawing only; grid subdivisions still describe the current tensor. */
export function manualTensorGridGeometry(
  shape: TensorShape | undefined,
  size: NodeEntity['size'],
  depth: number,
  angleDeg: number,
  options: BlockOptions,
): Result<BlockGeometry> {
  const values = [shape?.W, shape?.H, shape?.D === undefined ? shape?.C : shape.D];
  if (!values.every(positive))
    return fail('TENSOR_SIZE_PENDING', '尺寸尚未确定，暂不绘制网格分割。');
  const counts = (values as number[]).map((value) =>
    Math.min(TENSOR_GRID_LIMIT, Math.max(1, Math.floor(value))),
  );
  return buildGrid(
    size,
    depth,
    angleDeg,
    { width: counts[0], height: counts[1], depth: counts[2] },
    options,
  );
}

/** Grid strokes are saved polygons, so manual edits need neither a new schema nor saved tensor sizes. */
export function resizeTensorGridSnapshot(
  node: NodeEntity,
  size: NodeEntity['size'],
  depth: number,
  angleDeg: number,
  options: BlockOptions,
): Result<BlockGeometry> {
  const lines = node.primitives.filter(
    (p): p is Extract<Primitive, { kind: 'polygon' }> =>
      p.kind === 'polygon' && p.strokeWidth === 0 && p.opacity === 0.55,
  );
  if (!lines.length)
    return buildBlockGeometry(
      size,
      { mode: 'axonometric', depth, angleDeg, stackCount: 1, stackGap: 0 },
      options,
    );
  let width = 1,
    height = 1,
    z = 1;
  for (const line of lines) {
    const center = line.points.reduce((p, q) => ({ x: p.x + q.x / 4, y: p.y + q.y / 4 }), {
        x: 0,
        y: 0,
      }),
      horizontal = Math.abs(line.points[1].y - line.points[0].y) < 1e-6,
      vertical = Math.abs(line.points[1].x - line.points[0].x) < 1e-6;
    if (center.x > 0 && center.x < node.size.width && center.y > 0 && center.y < node.size.height) {
      if (vertical) width++;
      if (horizontal) height++;
    }
  }
  if ((node.figure?.tensorProjection?.depth ?? 0) > 0)
    for (let i = lines.length - 1; i >= 0; i--) {
      if (Math.abs(lines[i].points[1].x - lines[i].points[0].x) > 1e-6) break;
      z++;
    }
  return buildGrid(size, depth, angleDeg, { width, height, depth: z }, options);
}

/** Only newly placed objects receive a snapshot. Existing drawing geometry remains authoritative. */
export function finalizeTensorFigure(
  doc: ProjectDocument,
  operations: readonly ResolvedOperation[],
  computations: ComputationRegistry,
): ResolvedOperation[] {
  const report = analyzeDocument(doc, computations);
  return operations.map((operation) => {
    if (operation.kind !== 'put' || operation.entity.kind !== 'node') return operation;
    const node = operation.entity,
      previous = doc.entities[node.id],
      source = node.figure?.semanticRef ? semanticTarget(doc, node.figure.semanticRef) : node,
      params = source?.generation?.source;
    if (
      !source?.semantic ||
      source.semantic.role === 'operation' ||
      params?.kind !== 'local' ||
      (!automaticTensorDisplay(params.params) && params.params.displayMode !== 'manual') ||
      (previous && !(previous.figureState === 'unplaced' && node.figureState === 'visible'))
    )
      return operation;
    const entry = report.nodes[source.id];
    if (entry?.state !== 'ready') return operation;
    const face = node.primitives.find((p) => p.kind === 'rect'),
      style = {
        fill: face?.kind === 'rect' ? face.fill : '#a9cad9',
        stroke: '#637486',
      },
      manual = params.params.displayMode === 'manual',
      savedDepth = node.figure?.tensorProjection?.depth ?? params.params.depth,
      savedAngle = node.figure?.tensorProjection?.angleDeg ?? params.params.angleDeg;
    if (
      manual &&
      (typeof savedDepth !== 'number' ||
        !Number.isFinite(savedDepth) ||
        savedDepth < 0 ||
        savedDepth > 200 ||
        typeof savedAngle !== 'number' ||
        !Number.isFinite(savedAngle) ||
        savedAngle < 0 ||
        savedAngle > 80)
    )
      return operation;
    const depth = manual ? (savedDepth as number) : 0,
      angle = manual ? (savedAngle as number) : 30,
      manualGrid = manual
        ? manualTensorGridGeometry(entry.shape, node.size, depth, angle, style)
        : undefined,
      grid: Result<
        BlockGeometry & { size: NodeEntity['size']; depth: number; compressed: boolean }
      > = manualGrid
        ? manualGrid.ok
          ? ok({ ...manualGrid.value, size: node.size, depth, compressed: false })
          : manualGrid
        : tensorGridGeometry(entry.shape, params.params, style);
    if (!grid.ok) return operation;
    const copy = structuredClone(node),
      sx = grid.value.size.width / node.size.width,
      sy = grid.value.size.height / node.size.height;
    copy.size = grid.value.size;
    copy.bounds = grid.value.bounds;
    copy.primitives = grid.value.primitives;
    if (grid.value.compressed) {
      copy.primitives.push({
        kind: 'text',
        text: '压缩示意',
        x: 0,
        y: copy.size.height + 10,
        width: 100,
        height: 18,
        fontSize: 12,
        color: '#536574',
      });
      copy.bounds = {
        ...copy.bounds,
        width: Math.max(copy.bounds.width, 100 - copy.bounds.x),
        height: Math.max(copy.bounds.height, copy.size.height + 28 - copy.bounds.y),
      };
    }
    const outputPort =
      source.generation && computations.get(source.generation.generatorId)?.outputPort;
    copy.ports = Object.fromEntries(
      Object.entries(node.ports).map(([key, port]) => [
        key,
        'x' in port
          ? key === outputPort
            ? {
                x: grid.value.size.width + grid.value.depth * Math.cos((angle * Math.PI) / 180),
                y:
                  grid.value.size.height / 2 -
                  (grid.value.depth * Math.sin((angle * Math.PI) / 180)) / 2,
              }
            : { x: port.x * sx, y: port.y * sy }
          : { ...port },
      ]),
    );
    if (copy.figure) copy.figure.tensorProjection = { depth: grid.value.depth, angleDeg: angle };
    else if (copy.generation?.source.kind === 'local')
      Object.assign(copy.generation.source.params, {
        drawWidth: copy.size.width,
        drawHeight: copy.size.height,
        depth: grid.value.depth,
        angleDeg: angle,
      });
    return { ...operation, entity: copy };
  });
}

/** v2 shares structure and drawing IDs; structure builds must retain an already placed snapshot. */
export function preserveTensorFigureSnapshots(
  doc: ProjectDocument,
  operations: readonly ResolvedOperation[],
): ResolvedOperation[] {
  if (doc.schemaVersion !== 2) return [...operations];
  return operations.map((operation) => {
    if (operation.kind !== 'put' || operation.entity.kind !== 'node') return operation;
    const old = doc.entities[operation.entity.id],
      node = operation.entity;
    if (
      old?.kind !== 'node' ||
      !old.semantic ||
      old.semantic.role === 'operation' ||
      old.figureState === 'unplaced'
    )
      return operation;
    const oldParams = old.generation?.source,
      newParams = node.generation?.source,
      geometryChanged =
        oldParams?.kind === 'local' &&
        newParams?.kind === 'local' &&
        ['drawWidth', 'drawHeight', 'depth', 'angleDeg'].some(
          (key) => oldParams.params[key] !== newParams.params[key],
        );
    if (geometryChanged && newParams?.kind === 'local') {
      const face = node.primitives.find((p) => p.kind === 'rect'),
        resized = resizeTensorGridSnapshot(
          old,
          node.size,
          Number(newParams.params.depth),
          Number(newParams.params.angleDeg),
          { fill: face?.kind === 'rect' ? face.fill : '#a9cad9', stroke: '#637486' },
        );
      return resized.ok
        ? {
            ...operation,
            entity: {
              ...node,
              figureState: old.figureState,
              primitives: resized.value.primitives,
              bounds: resized.value.bounds,
            },
          }
        : operation;
    }
    const ports = structuredClone(old.ports);
    for (const [key, port] of Object.entries(node.ports))
      if (!Object.hasOwn(ports, key))
        ports[key] =
          'x' in port
            ? {
                x: (port.x * old.size.width) / node.size.width,
                y: (port.y * old.size.height) / node.size.height,
              }
            : { ...port };
    return {
      ...operation,
      entity: {
        ...node,
        figureState: old.figureState,
        size: structuredClone(old.size),
        bounds: structuredClone(old.bounds),
        primitives: structuredClone(old.primitives),
        ports,
      },
    };
  });
}
