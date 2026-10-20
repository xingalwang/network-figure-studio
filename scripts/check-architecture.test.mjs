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

test('core cannot depend on UI, storage, canvas adapters or framework packages, including type imports', () => {
  for (const specifier of [
    '../app/session.ts',
    '../workspaces/shared/Field.tsx',
    '../persistence/autosave.ts',
    '../adapters/maxgraph/adapter.ts',
    'react',
    'react/jsx-runtime',
    '@maxgraph/core',
  ])
    assert.ok(boundaryViolation('src/core/example.ts', specifier), specifier);
  for (const specifier of ['./document/types.ts', '../plugins/sdk.ts', '../graphics/primitives.ts'])
    assert.equal(boundaryViolation('src/core/example.ts', specifier), undefined);
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
  assert.equal(
    boundaryViolation('src/app/editor/useEditor.ts', '../../workspaces/shared/parameter-drafts.ts'),
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
