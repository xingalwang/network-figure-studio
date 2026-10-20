import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/__test__/canvas');
  await page.waitForFunction(() => typeof window.__studio?.exportSvg === 'function');
});

test('v3 projects computation and independent figures into their own workspaces', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const paths = {
      codec: '/src/core/document/codec.ts',
      store: '/src/core/commands/store.ts',
      figure: '/src/core/figure/index.ts',
      adapter: '/src/adapters/maxgraph/adapter.ts',
      tensor: '/src/core/tensor-composition.ts',
      registry: '/src/builtins/registry.ts',
      generation: '/src/core/generation/merge.ts',
      exports: '/src/graphics/export.ts',
    };
    const [codec, stores, figures, adapters, tensors, registries, generation, exporters] =
      await Promise.all(Object.values(paths).map((path) => import(/* @vite-ignore */ path)));
    const registry = registries.createBuiltinRegistry();
    const legacy = stores.createDocumentStore(
      codec.createProject('projection', 2),
      generation.createGenerationServices(registry),
    );
    const added = await tensors.addTensorSource(legacy, registry, { x: 40, y: 70 }, 2);
    if (!added.ok) throw Error(added.error.message);
    const source = structuredClone(legacy.getSnapshot().entities[added.value]);
    Object.assign(source.generation.source.params, { N: 1, H: 64, W: 64, C: 3 });
    await legacy.dispatch({
      baseRevision: legacy.getSnapshot().revision,
      operations: [{ kind: 'put', entity: source }],
    });
    const activated = await tensors.appendTensorOperation(
      legacy,
      registry,
      [added.value],
      'example.leaky-relu',
      { alpha: 0.2 },
    );
    if (!activated.ok) throw Error(activated.error.message);
    await legacy.dispatch({
      baseRevision: legacy.getSnapshot().revision,
      operations: tensors.planPlaceTensorFigure(legacy.getSnapshot()),
    });
    const store = stores.createDocumentStore(codec.migrateProjectV3(legacy.getSnapshot()));
    const note = figures.planAddFigureAnnotation(store.getSnapshot(), '图稿独立说明', {
      x: 320,
      y: 100,
    });
    if (!note.ok) throw Error(note.error.message);
    await store.dispatch({
      baseRevision: store.getSnapshot().revision,
      operations: note.value.operations,
    });
    const extra = figures.planAddFigureRepresentation(store.getSnapshot(), added.value, {
      x: 600,
      y: 100,
    });
    if (!extra.ok) throw Error(extra.error.message);
    await store.dispatch({
      baseRevision: store.getSnapshot().revision,
      operations: extra.value.operations,
    });
    const containers = ['figure', 'structure'].map(() => {
      const container = document.createElement('div');
      container.style.cssText = 'width:1000px;height:600px;position:relative';
      document.body.append(container);
      return container;
    });
    const figure = adapters.createGraphAdapter(
      containers[0],
      store,
      (error: string) => {
        throw Error(error);
      },
      'figure',
      'dark',
      registry.computations,
    );
    const structure = adapters.createGraphAdapter(
      containers[1],
      store,
      (error: string) => {
        throw Error(error);
      },
      'structure',
      'dark',
      registry.computations,
    );
    try {
      const has = (adapter: any, id: string) => !!adapter.graph.getDataModel().getCell(id);
      const operation = Object.values(store.getSnapshot().entities).find(
        (entity: any) => entity.figure?.semanticRef === activated.value.operationId,
      ) as any;
      const exported = await exporters.exportSvg(
        store.getSnapshot(),
        {
          range: 'content',
          margin: 12,
          background: 'transparent',
          width: 1000,
          height: 500,
          embedFonts: false,
        },
        registry.computations,
      );
      const xml = new DOMParser().parseFromString(await exported.text(), 'image/svg+xml');
      return {
        registeredOperationText: figure.graph
          .getDataModel()
          .getCell(operation.id)
          ?.value.visual.primitives.map((p: any) => p.text ?? '')
          .join(''),
        svgHasRegisteredOperationName: [...xml.querySelectorAll('text')].some(
          (node) => node.textContent === 'LeakyReLU',
        ),
        semanticInFigure: has(figure, added.value),
        semanticInStructure: has(structure, added.value),
        extraInFigure: has(figure, extra.value.id),
        extraInStructure: has(structure, extra.value.id),
        noteInFigure: has(figure, note.value.id),
        noteInStructure: has(structure, note.value.id),
        registeredShapeText: figure.graph
          .getDataModel()
          .getCell(extra.value.id)
          ?.value.visual.primitives.map((p: any) => p.text ?? '')
          .join(''),
        noteText: figure.graph
          .getDataModel()
          .getCell(note.value.id)
          ?.value.visual.primitives.map((p: any) => p.text ?? '')
          .join(''),
      };
    } finally {
      figure.dispose();
      structure.dispose();
      containers.forEach((container) => container.remove());
    }
  });
  expect(result).toEqual({
    semanticInFigure: false,
    semanticInStructure: true,
    extraInFigure: true,
    extraInStructure: false,
    noteInFigure: true,
    noteInStructure: false,
    noteText: '图稿独立说明',
    registeredShapeText: '2D 数据张量64×64C3',
    registeredOperationText: 'LeakyReLUalpha = 0.2',
    svgHasRegisteredOperationName: true,
  });
});

test('independent annotation is editable vector text in SVG and survives PNG rendering', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const paths = [
      '/src/core/document/codec.ts',
      '/src/core/figure/index.ts',
      '/src/graphics/export.ts',
    ];
    const [codec, figures, exporters] = await Promise.all(
      paths.map((path) => import(/* @vite-ignore */ path)),
    );
    const doc = codec.createProject('annotation export', 3);
    const note = figures.planAddFigureAnnotation(doc, '独立中文标注', { x: 80, y: 80 });
    if (!note.ok) throw Error(note.error.message);
    for (const op of note.value.operations)
      if (op.kind === 'put') doc.entities[op.entity.id] = op.entity;
    const options = {
      range: 'content',
      margin: 12,
      background: 'transparent',
      width: 640,
      height: 240,
      embedFonts: false,
    };
    const svg = await exporters.exportSvg(doc, options);
    const xml = new DOMParser().parseFromString(await svg.text(), 'image/svg+xml');
    const png = await exporters.exportPng(doc, options);
    const bitmap = await createImageBitmap(png);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) ink++;
    return {
      text: [...xml.querySelectorAll('text')].map((node) => node.textContent).join(''),
      imageCount: xml.querySelectorAll('image').length,
      width: canvas.width,
      height: canvas.height,
      ink,
    };
  });
  expect(result.text).toContain('独立中文标注');
  expect(result.imageCount).toBe(0);
  expect(result.width).toBe(640);
  expect(result.height).toBe(240);
  expect(result.ink).toBeGreaterThan(100);
});
