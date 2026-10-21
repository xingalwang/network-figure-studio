import { expect, test } from 'vitest';
import { buildModuleCatalog, operationUnavailableReason } from '../../src/app/modules/catalog.ts';
import {
  decodeModuleSelection,
  normalizeModuleSelection,
} from '../../src/app/modules/preferences.tsx';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createProject } from '../../src/core/document/codec.ts';
import { createGenerationServices } from '../../src/core/generation/merge.ts';
import { addTensorSource } from '../../src/core/tensor-composition.ts';
import { analyzeDocument } from '../../src/core/computation/index.ts';

const registry = createBuiltinRegistry();
const modules = buildModuleCatalog(registry);

test('module catalog derives all creation tools from their owning registry declarations', () => {
  const builtin = modules.find((module) => module.id === 'builtin')!;
  expect(builtin.name).toBe('基础深度学习');
  expect(builtin.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'tensor.source3d', kind: 'data', dimension: 3 }),
      expect.objectContaining({ id: 'tensor.relu', kind: 'operation', name: 'ReLU' }),
      expect.objectContaining({ id: 'tensor.pool2d', kind: 'operation' }),
      expect.objectContaining({ id: 'builtin.chain', kind: 'connection' }),
    ]),
  );
  expect(builtin.entries.some((entry) => entry.id === 'tensor.result3d')).toBe(false);
  expect(modules.find((module) => module.id === 'example.leaky-relu')?.entries).toContainEqual(
    expect.objectContaining({ id: 'example.leaky-relu', kind: 'operation' }),
  );
  for (const module of modules)
    expect(new Set(module.entries.map((entry) => entry.id)).size).toBe(module.entries.length);
});

test('module preferences default to all and restore an intentional empty selection', () => {
  expect(decodeModuleSelection(null, modules)).toEqual(modules.map((module) => module.id));
  const saved = JSON.stringify({ knownIds: modules.map((module) => module.id), enabledIds: [] });
  expect(decodeModuleSelection(saved, modules)).toEqual([]);
  expect(decodeModuleSelection('invalid', modules)).toEqual(modules.map((module) => module.id));
  expect(normalizeModuleSelection(['builtin', 'builtin', 'unknown'], modules)).toEqual(['builtin']);
});

test('new registered modules appear without re-enabling previously hidden ones', () => {
  const saved = JSON.stringify({ knownIds: ['builtin'], enabledIds: [] });
  expect(decodeModuleSelection(saved, modules)).toEqual(
    modules.filter((module) => module.id !== 'builtin').map((module) => module.id),
  );
});

test('compatibility uses registered dimensions and input counts while hidden modules keep their rules', async () => {
  const store = createDocumentStore(
    createProject('模块可见性', 2),
    createGenerationServices(registry),
  );
  const first = await addTensorSource(store, registry, undefined, 2);
  const second = await addTensorSource(store, registry, undefined, 3);
  if (!first.ok || !second.ok) throw Error('source creation failed');
  const doc = store.getSnapshot();
  expect(operationUnavailableReason(registry, doc, [first.value], 'tensor.conv2d')).toBeNull();
  expect(operationUnavailableReason(registry, doc, [first.value], 'tensor.conv3d')).toContain('3D');
  expect(operationUnavailableReason(registry, doc, [first.value], 'tensor.concat')).toContain(
    '2–8',
  );
  expect(
    operationUnavailableReason(registry, doc, [first.value, second.value], 'tensor.concat'),
  ).toContain('维数');
  expect(operationUnavailableReason(registry, doc, [], 'tensor.relu')).toContain('选择');
  const hidden = decodeModuleSelection(
    JSON.stringify({ knownIds: modules.map((module) => module.id), enabledIds: [] }),
    modules,
  );
  expect(hidden).toEqual([]);
  expect(analyzeDocument(doc, registry.computations).nodes[first.value]).toBeDefined();
  expect(store.getSnapshot()).toBe(doc);
});
