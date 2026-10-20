import type { Entity, ProjectDocument } from '../document/types.ts';
import type { ComputationDefinition, ComputationRegistry } from './definitions.ts';
import { paramsOf } from './catalog.ts';

const defaults: ComputationRegistry = new Map();
export const defaultComputations = (): ComputationRegistry => defaults;

export function resolveComputation(
  entity: Entity | undefined,
  registry: ComputationRegistry = defaults,
): ComputationDefinition | undefined {
  if (entity?.kind !== 'node' || !entity.semantic || !entity.generation) return;
  const binding = entity.generation,
    definition = registry.get(binding.generatorId);
  return definition &&
    definition.version === binding.version &&
    definition.paramSchemaVersion === binding.paramSchemaVersion &&
    definition.role === entity.semantic.role
    ? definition
    : undefined;
}

export function resolveOperation(
  id: string,
  registry: ComputationRegistry = defaults,
): ComputationDefinition | undefined {
  const definition = registry.get(id) ?? [...registry.values()].find((d) => d.kind === id);
  return definition?.role === 'operation' && definition.operation ? definition : undefined;
}

export function listAvailableOperations(
  doc: ProjectDocument,
  sourceIds: readonly string[],
  registry: ComputationRegistry = defaults,
): ComputationDefinition[] {
  if (!sourceIds.length || new Set(sourceIds).size !== sourceIds.length) return [];
  const dimensions = sourceIds.map((id) => {
    const entity = doc.entities[id],
      definition = resolveComputation(entity, registry);
    return entity?.kind === 'node' && definition && definition.role !== 'operation'
      ? definition.dimension(paramsOf(entity))
      : null;
  });
  const dimension = dimensions[0];
  if (!dimension || dimensions.some((d) => d !== dimension)) return [];
  return [...registry.values()].filter((d) => {
    const operation = d.operation;
    return (
      d.role === 'operation' &&
      operation &&
      sourceIds.length >= operation.minInputs &&
      sourceIds.length <= operation.maxInputs &&
      operation.dimensions.includes(dimension)
    );
  });
}
