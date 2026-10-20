import type { Entity, Params, ProjectDocument } from '../document/types.ts';

export type ParamField = { key: string; label: string; section?: 'structure' | 'appearance' } & (
  | { type: 'number'; min: number; max: number; step?: number; nullable?: boolean }
  | { type: 'text' }
  | { type: 'boolean' }
  | { type: 'color' }
  | { type: 'enum'; options: { value: string; label: string }[] }
  | { type: 'list'; item: ParamField }
);
export type GraphFragment = { rootKey: string; entities: Record<string, Entity> };
export type GeneratorDefinition = {
  id: string;
  version: string;
  paramSchemaVersion: number;
  name: string;
  description: string;
  defaults: Params;
  fields: ParamField[];
  generate(
    params: Params,
    theme: ProjectDocument['theme'],
    previousLocalKeys?: Record<string, string>,
  ): GraphFragment | Promise<GraphFragment>;
};
