import type { Entity, NodeEntity, Params } from '../document/types.ts';
import type { TensorAxis, TensorKind, TensorShape } from './types.ts';
const kinds: Record<string, TensorKind> = {
  'tensor.source2d': 'source',
  'tensor.result2d': 'result',
  'tensor.conv2d': 'conv2d',
  'tensor.pool2d': 'pool2d',
  'tensor.source3d': 'source',
  'tensor.result3d': 'result',
  'tensor.conv3d': 'conv3d',
  'tensor.pool3d': 'pool3d',
  'tensor.relu': 'relu',
  'tensor.upsample': 'upsample',
  'tensor.concat': 'concat',
  'tensor.add': 'add',
};
export function tensorKind(entity: Entity | undefined): TensorKind | null {
  return entity?.kind === 'node' && entity.semantic
    ? (kinds[entity.generation?.generatorId ?? ''] ?? null)
    : null;
}
export const paramsOf = (node: NodeEntity): Params =>
  node.generation?.source.kind === 'local' ? node.generation.source.params : {};
export function tensorDimension(entity: Entity | undefined): 2 | 3 | null {
  if (!tensorKind(entity) || entity?.kind !== 'node') return null;
  const id = entity.generation!.generatorId;
  if (id.endsWith('2d')) return 2;
  if (id.endsWith('3d')) return 3;
  const dimension = paramsOf(entity).dimension;
  return dimension === 2 || dimension === 3 ? dimension : null;
}
export function shapeAxes(dimension: 2 | 3): TensorAxis[] {
  return dimension === 2 ? ['N', 'H', 'W', 'C'] : ['N', 'D', 'H', 'W', 'C'];
}
export function spatialAxes(dimension: 2 | 3): TensorAxis[] {
  return dimension === 2 ? ['H', 'W'] : ['D', 'H', 'W'];
}
export function shapeDimension(shape: TensorShape): 2 | 3 {
  return Object.hasOwn(shape, 'D') ? 3 : 2;
}
