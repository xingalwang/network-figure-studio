import type { Entity, NodeEntity, Params } from '../document/types.ts';
import type { TensorAxis, TensorKind, TensorShape } from './types.ts';
import type { ComputationRegistry } from './definitions.ts';
import { defaultComputations, resolveComputation } from './registry.ts';
export function tensorKind(
  entity: Entity | undefined,
  registry: ComputationRegistry = defaultComputations(),
): TensorKind | null {
  if (entity?.kind !== 'node' || !entity.semantic) return null;
  const definition = resolveComputation(entity, registry);
  return definition?.kind ?? (definition ? definition.generatorId : null);
}
export const paramsOf = (node: NodeEntity): Params =>
  node.generation?.source.kind === 'local' ? node.generation.source.params : {};
export function tensorDimension(
  entity: Entity | undefined,
  registry: ComputationRegistry = defaultComputations(),
): 2 | 3 | null {
  if (entity?.kind !== 'node' || !entity.semantic) return null;
  return resolveComputation(entity, registry)?.dimension(paramsOf(entity)) ?? null;
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
