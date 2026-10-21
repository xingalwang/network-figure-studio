import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectImports, boundaryViolation, checkArchitecture } from './check-architecture.mjs';

test('collects static, re-export, dynamic and type imports without matching comments or strings', async () => {
  const source = `
    // import 'react';
    const example = "import 'react'";
    import type { Shape } from './shape.ts';
    export { shape } from './shape.ts';
    export * from './public.ts';
    const lazy = import('./lazy.ts');
    type Type = import('./types.ts').Type;
  `;
  assert.deepEqual(
    (await collectImports(source, 'src/core/example.ts')).map((x) => x.specifier),
    ['./shape.ts', './shape.ts', './public.ts', './lazy.ts', './types.ts'],
  );
});

test('identifies type-only dependencies and statically known dynamic imports', async () => {
  const imports = await collectImports(
    `import type { Contract } from './contract.ts';
import { type Model } from './model.ts';
export type { Contract } from './contract.ts';
export { type Model } from './model.ts';
type Local = import('./local.ts').Local;
const lazy = import(\`./lazy.ts\`);
const runtime = import(moduleName);
import legacy = require('./legacy.ts');
const required = require('./required.ts');`,
    'src/core/example.ts',
  );
  assert.deepEqual(
    imports.map(({ specifier, typeOnly }) => ({ specifier, typeOnly })),
    [
      ...['./contract.ts', './model.ts', './contract.ts', './model.ts', './local.ts'].map(
        (specifier) => ({ specifier, typeOnly: true }),
      ),
      { specifier: './lazy.ts', typeOnly: false },
      { specifier: null, typeOnly: false },
      { specifier: './legacy.ts', typeOnly: false },
      { specifier: './required.ts', typeOnly: false },
    ],
  );
});

test('core cannot depend on UI, storage, canvas adapters or framework packages, including type imports', () => {
  for (const specifier of [
    '../app/session.ts',
    '../workspaces/shared/Field.tsx',
    '../ui/Field.tsx',
    '../persistence/autosave.ts',
    '../adapters/maxgraph/adapter.ts',
    'react',
    'react/jsx-runtime',
    '@maxgraph/core',
  ])
    assert.ok(boundaryViolation('src/core/example.ts', specifier), specifier);
  for (const specifier of ['./document/types.ts'])
    assert.equal(boundaryViolation('src/core/example.ts', specifier), undefined);
});

test('core shares only graphic value types and leaves rendering to graphics', () => {
  assert.equal(
    boundaryViolation('src/core/document/types.ts', '../../graphics/primitives', {
      typeOnly: true,
    }),
    undefined,
  );
  assert.ok(boundaryViolation('src/core/example.ts', '../graphics/primitives.ts'));
  assert.ok(
    boundaryViolation('src/core/example.ts', '../graphics/primitives.ts', { typeOnly: true }),
  );
  assert.ok(
    boundaryViolation('src/core/example.ts', '../graphics/block-geometry.ts', { typeOnly: true }),
  );
});

test('core cannot load concrete builtins or the plugin runtime and computation stays generic', () => {
  assert.ok(boundaryViolation('src/core/example.ts', '../builtins/computations.ts'));
  assert.ok(boundaryViolation('src/core/example.ts', '../plugins/registry.ts'));
  assert.equal(
    boundaryViolation('src/core/example.ts', '../plugins/registry.ts', { typeOnly: true }),
    undefined,
  );
  for (const specifier of [
    '../../builtins/computations.ts',
    '../../plugins/sdk.ts',
    '../../graphics/primitives.ts',
    'a-rule-library',
  ])
    assert.ok(
      boundaryViolation('src/core/computation/propagation.ts', specifier, { typeOnly: true }),
      specifier,
    );
  assert.equal(
    boundaryViolation('src/core/computation/propagation.ts', '../document/types.ts'),
    undefined,
  );
});

test('only the compatibility SDK bridge can access builtins from plugins', () => {
  assert.equal(boundaryViolation('src/plugins/sdk.ts', '../builtins/layers.ts'), undefined);
  assert.ok(boundaryViolation('src/plugins/registry.ts', '../builtins/layers.ts'));
  assert.ok(boundaryViolation('src/plugins/sdk.ts', '../builtins/computations.ts'));
});

test('preserves the existing rendering bridge while keeping presentation out of lower-level modules', () => {
  assert.equal(
    boundaryViolation('src/graphics/export.ts', '../adapters/maxgraph/adapter.ts'),
    undefined,
  );
  assert.equal(boundaryViolation('src/graphics/paint.ts', '@maxgraph/core'), undefined);
  assert.ok(boundaryViolation('src/graphics/paint.ts', '../app/theme/preferences.ts'));
  assert.ok(boundaryViolation('src/persistence/autosave.ts', '../app/session.ts'));
  assert.ok(
    boundaryViolation('src/plugins/registry.ts', '../workspaces/generator/ParameterForm.tsx'),
  );
  assert.ok(boundaryViolation('src/builtins/tensors.ts', '../adapters/maxgraph/adapter.ts'));
});

test('editor models use shared contracts rather than concrete inspector components', () => {
  assert.ok(
    boundaryViolation('src/app/editor/useEditor.ts', '../../workspaces/drawing/Inspector.tsx'),
  );
  assert.ok(
    boundaryViolation(
      'src/app/editor/controller.ts',
      '../../workspaces/generator/TensorInspector.tsx',
    ),
  );
  assert.ok(
    boundaryViolation('src/app/editor/useEditor.ts', '../../workspaces/shared/parameter-drafts.ts'),
  );
  assert.equal(
    boundaryViolation('src/app/editor/useEditor.ts', './parameter-drafts.ts'),
    undefined,
  );
});

test('plugin examples consume the public SDK rather than internal host modules', () => {
  assert.equal(
    boundaryViolation('examples/plugins/attention/index.ts', '../../../src/plugins/sdk.ts'),
    undefined,
  );
  assert.equal(
    boundaryViolation('examples/plugins/attention/index.ts', './manifest.ts'),
    undefined,
  );
  assert.ok(
    boundaryViolation('examples/plugins/attention/index.ts', '../../../src/core/document/types.ts'),
  );
  assert.ok(
    boundaryViolation('examples/plugins/attention/index.ts', '../../../src/app/session.ts'),
  );
  for (const specifier of ['/src/core/document/types.ts', 'src/core/document/types.ts'])
    assert.ok(boundaryViolation('examples/plugins/attention/index.ts', specifier));
  assert.ok(boundaryViolation('examples/plugins/attention/index.ts', '../residual/generator.ts'));
});

test('only the builtin composition root loads extension examples', () => {
  const extension = '../../examples/plugins/attention/index.ts';
  assert.equal(boundaryViolation('src/builtins/registry.ts', extension), undefined);
  for (const file of ['src/core/example.ts', 'src/plugins/sdk.ts', 'src/builtins/layers.ts'])
    assert.ok(boundaryViolation(file, extension), file);
});

test('computed module paths cannot bypass dependency checks', () => {
  assert.ok(boundaryViolation('src/core/example.ts', null));
  assert.ok(boundaryViolation('examples/plugins/attention/index.ts', null));
});

test('scans source and examples and reports violations with the importing line', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jiagoutu-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries({
    'src/core/example.ts': "// sample\nimport type { App } from '../app/App.tsx';\n",
    'src/graphics/export.ts': "import { render } from '../adapters/maxgraph/adapter.ts';\n",
    'examples/plugins/sample/index.ts':
      "export type { ProjectDocument } from '../../../src/core/document/types.ts';\n",
  })) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), source);
  }
  const result = await checkArchitecture(root);
  assert.equal(result.files, 3);
  assert.deepEqual(
    result.violations.map(({ file, line, specifier }) => ({ file, line, specifier })),
    [
      { file: 'src/core/example.ts', line: 2, specifier: '../app/App.tsx' },
      {
        file: 'examples/plugins/sample/index.ts',
        line: 1,
        specifier: '../../../src/core/document/types.ts',
      },
    ],
  );
});

test('scans module variants and rejects dynamic, re-export and type boundary violations', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jiagoutu-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries({
    'src/core/example.mts': "export type { Concrete } from '../builtins/concrete.ts';\n",
    'src/core/runtime.cts': "const implementation = import('../plugins/registry.ts');\n",
    'src/core/contract.ts': "import { type PluginRegistry } from '../plugins/registry.ts';\n",
    'examples/plugins/sample/index.js': 'const module = import(modulePath);\n',
    'examples/plugins/sample/types.ts':
      "type Host = import('../../../src/core/document/types.ts').Host;\n",
  })) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), source);
  }
  const result = await checkArchitecture(root);
  assert.equal(result.files, 5);
  assert.deepEqual(
    result.violations.map(({ file, line }) => ({ file, line })),
    [
      { file: 'src/core/example.mts', line: 1 },
      { file: 'src/core/runtime.cts', line: 1 },
      { file: 'examples/plugins/sample/index.js', line: 1 },
      { file: 'examples/plugins/sample/types.ts', line: 1 },
    ],
  );
});

test('UI controls and shared canvas cannot depend on business views', () => {
  for (const target of [
    '../app/editor/controller.ts',
    '../core/document/types.ts',
    '../workspaces/shared/GraphView.tsx',
  ])
    assert.ok(boundaryViolation('src/ui/Field.tsx', target, { typeOnly: true }));
  assert.equal(boundaryViolation('src/ui/controls.tsx', './Field.tsx'), undefined);
  assert.ok(
    boundaryViolation('src/workspaces/generator/TensorCanvas.tsx', '../drawing/GraphView.tsx'),
  );
  assert.ok(
    boundaryViolation('src/workspaces/shared/GraphView.tsx', '../generator/TensorCanvas.tsx'),
  );
  assert.equal(
    boundaryViolation('src/workspaces/generator/TensorCanvas.tsx', '../shared/GraphView.tsx'),
    undefined,
  );
});

test('workspace panels consume editor actions rather than assembling temporary projects', () => {
  for (const target of [
    '../../core/commands/store.ts',
    '../../core/tensor-composition.ts',
    '../../core/generation/draft.ts',
    '../../core/computation/index.ts',
  ])
    assert.ok(boundaryViolation('src/workspaces/generator/TensorOperationPanel.tsx', target));
  assert.equal(
    boundaryViolation(
      'src/workspaces/generator/TensorOperationPanel.tsx',
      '../../core/commands/store.ts',
      { typeOnly: true },
    ),
    undefined,
  );
  assert.equal(
    boundaryViolation(
      'src/workspaces/generator/TensorOperationPanel.tsx',
      '../../app/editor/operation-draft.ts',
    ),
    undefined,
  );
});
