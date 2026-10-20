import {
  fail,
  ok,
  type NodeEntity,
  type Point,
  type Primitive,
  type ProjectDocument,
  type ResolvedOperation,
  type Result,
} from '../core/document/types.ts';
import { semanticTarget } from '../core/figure/index.ts';
import { buildBlockGeometry } from './block-geometry.ts';

export type FigureAppearance = {
  drawWidth: number;
  drawHeight: number;
  depth: number;
  angleDeg: number;
};

/** The selected representation owns its display geometry, independently of its source. */
export function figureAppearance(_doc: ProjectDocument, node: NodeEntity): FigureAppearance {
  return {
    drawWidth: node.size.width,
    drawHeight: node.size.height,
    depth: node.figure?.tensorProjection?.depth ?? 0,
    angleDeg: node.figure?.tensorProjection?.angleDeg ?? 0,
  };
}

function scalePrimitive(primitive: Primitive, sx: number, sy: number): Primitive {
  if (primitive.kind === 'polygon')
    return { ...primitive, points: primitive.points.map((p) => ({ x: p.x * sx, y: p.y * sy })) };
  return {
    ...primitive,
    x: primitive.x * sx,
    y: primitive.y * sy,
    width: primitive.width * sx,
    height: primitive.height * sy,
  };
}

/** Rebuild the saved drawing snapshot in the same transaction as its display parameters. */
export function planUpdateFigureAppearance(
  doc: ProjectDocument,
  id: string,
  values: FigureAppearance,
): Result<ResolvedOperation[]> {
  const entity = doc.entities[id];
  if (
    doc.schemaVersion !== 3 ||
    entity?.kind !== 'node' ||
    entity.figure?.role !== 'representation' ||
    !semanticTarget(doc, id)
  )
    return fail('NOT_REPRESENTATION', '请选择一个计算对象的独立图稿表示。');
  if (entity.locked) return fail('LOCKED', '图稿对象已锁定。', [id]);
  if (
    ![values.drawWidth, values.drawHeight, values.depth, values.angleDeg].every(Number.isFinite) ||
    values.drawWidth < 24 ||
    values.drawWidth > 1000 ||
    values.drawHeight < 24 ||
    values.drawHeight > 1000 ||
    values.depth < 0 ||
    values.depth > 200 ||
    values.angleDeg < 0 ||
    values.angleDeg > 80
  )
    return fail(
      'INVALID_FIGURE_APPEARANCE',
      '显示宽高须为 24–1000，厚度为 0–200，投影角度为 0–80。',
    );
  const copy = structuredClone(entity),
    sx = values.drawWidth / entity.size.width,
    sy = values.drawHeight / entity.size.height;
  copy.size = { width: values.drawWidth, height: values.drawHeight };
  if (entity.figure.tensorProjection) {
    const face = [...entity.primitives]
      .reverse()
      .find((p) => p.kind === 'rect' || p.kind === 'ellipse');
    const geometry = buildBlockGeometry(
      copy.size,
      {
        mode: 'axonometric',
        depth: values.depth,
        angleDeg: values.angleDeg,
        stackCount: 1,
        stackGap: 0,
      },
      {
        fill: face && 'fill' in face ? face.fill : '#a9cad9',
        stroke: face && 'stroke' in face ? face.stroke : '#637486',
        ...(face && 'strokeWidth' in face && face.strokeWidth !== undefined
          ? { strokeWidth: face.strokeWidth }
          : {}),
      },
    );
    if (!geometry.ok) return geometry;
    copy.figure!.tensorProjection = { depth: values.depth, angleDeg: values.angleDeg };
    copy.primitives = geometry.value.primitives;
    copy.bounds = geometry.value.bounds;
  } else {
    copy.primitives = entity.primitives.map((primitive) => scalePrimitive(primitive, sx, sy));
    copy.bounds = {
      x: entity.bounds.x * sx,
      y: entity.bounds.y * sy,
      width: entity.bounds.width * sx,
      height: entity.bounds.height * sy,
    };
  }
  copy.ports = Object.fromEntries(
    Object.entries(entity.ports).map(([key, port]) => [
      key,
      'x' in port ? ({ x: port.x * sx, y: port.y * sy } satisfies Point) : { ...port },
    ]),
  );
  return ok([{ kind: 'put', entity: copy }]);
}
