import { expect, test } from '@playwright/test';

test('structure captions follow selection without changing geometry, history or preview behavior', async ({
  page,
}) => {
  await page.goto('/__test__/canvas');
  const result = await page.evaluate(async () => {
    const paths = [
      '/src/core/document/codec.ts',
      '/src/core/commands/store.ts',
      '/src/builtins/registry.ts',
      '/src/core/generation/merge.ts',
      '/src/core/tensor-composition.ts',
      '/src/adapters/maxgraph/adapter.ts',
    ];
    const [codec, stores, builtins, generation, tensors, adapters] = await Promise.all(
      paths.map((path) => import(/* @vite-ignore */ path)),
    );
    const registry = builtins.createBuiltinRegistry();
    const store = stores.createDocumentStore(
      codec.createProject('临时投影', 2),
      generation.createGenerationServices(registry),
    );
    const added = await tensors.addTensorSource(store, registry, { x: 80, y: 120 }, 2);
    if (!added.ok) throw Error(added.error.message);
    const source = store.getSnapshot().entities[added.value];
    await store.dispatch({
      baseRevision: store.getSnapshot().revision,
      operations: [
        {
          kind: 'generate',
          id: source.id,
          generatorId: source.generation.generatorId,
          params: { ...source.generation.source.params, H: 32, W: 16, C: 3 },
        },
      ],
    });
    const operation = await tensors.appendTensorOperation(store, registry, [source.id], 'relu');
    if (!operation.ok) throw Error(operation.error.message);
    const before = structuredClone(store.getSnapshot());
    const container = document.createElement('div');
    container.style.cssText = 'width:1000px;height:600px';
    document.body.append(container);
    const adapter = adapters.createGraphAdapter(
      container,
      store,
      (message: string) => {
        throw Error(message);
      },
      'structure',
      'dark',
      registry.computations,
    );
    try {
      adapter.graph.getView().scaleAndTranslate(0.75, 45, 60);
      const graph = adapter.graph,
        cell = graph.getDataModel().getCell(source.id),
        label = (id: string) => {
          const state = graph.getView().getState(graph.getDataModel().getCell(id));
          return state?.text
            ? {
                value: state.text.node.textContent,
                fontSize: state.style.fontSize,
                height: state.text.node.getBoundingClientRect().height,
              }
            : null;
        },
        bounds = (id: string) =>
          structuredClone(graph.getDataModel().getCell(id).value.visual.bounds),
        positions = () => {
          const view = graph.getView();
          return {
            cells: [source.id, `${source.id}:port:out`, operation.value.resultId].map((id) => {
              const state = view.getState(graph.getDataModel().getCell(id));
              return { id, x: state.x, y: state.y, width: state.width, height: state.height };
            }),
            scale: view.scale,
            translate: { x: view.translate.x, y: view.translate.y },
          };
        };
      const initialGeometry = positions(),
        initialBounds = [bounds(source.id), bounds(operation.value.resultId)],
        initiallyHidden = [label(source.id), label(operation.value.resultId)];
      adapter.setSelection([source.id]);
      const singleSelection = [label(source.id), label(operation.value.resultId)];
      graph.addSelectionCell(graph.getDataModel().getCell(operation.value.resultId));
      const multipleSelection = [label(source.id), label(operation.value.resultId)];
      graph.clearSelection();
      const cleared = [label(source.id), label(operation.value.resultId)],
        selectionState = {
          initiallyHidden,
          singleSelection,
          multipleSelection,
          cleared,
          sameCell: graph.getDataModel().getCell(source.id) === cell,
          initialGeometry,
          finalGeometry: positions(),
          unchanged: JSON.stringify(store.getSnapshot()) === JSON.stringify(before),
        };
      adapter.setSelection([source.id]);
      const preview = structuredClone(before);
      preview.entities[source.id].generation.source.params.H = 128;
      adapter.setProjectionDocument(preview);
      const previewResult = {
        bounds: [bounds(source.id), bounds(operation.value.resultId)],
        restoredCaption: label(source.id),
        unselectedCaption: label(operation.value.resultId),
        unchanged: JSON.stringify(store.getSnapshot()) === JSON.stringify(before),
        selection: adapter.getSelection(),
        scale: adapter.graph.getView().scale,
        translate: {
          x: adapter.graph.getView().translate.x,
          y: adapter.graph.getView().translate.y,
        },
      };
      const projectedCell = adapter.graph.getDataModel().getCell(source.id);
      adapter.graph.batchUpdate(() => {
        const geometry = projectedCell.getGeometry().clone();
        geometry.x += 30;
        geometry.y += 10;
        adapter.graph.getDataModel().setGeometry(projectedCell, geometry);
      });
      await Promise.resolve();
      const afterGesture = structuredClone(store.getSnapshot());
      adapter.setProjectionDocument(undefined);
      return {
        selectionState,
        initialBounds,
        preview: previewResult,
        revisionDelta: afterGesture.revision - before.revision,
        formalParams: afterGesture.entities[source.id].generation.source.params,
        formalPosition: afterGesture.entities[source.id].presentation.compositionPosition,
        finalBounds: [bounds(source.id), bounds(operation.value.resultId)],
        finalCaption: label(source.id),
        finalSelection: adapter.getSelection(),
      };
    } finally {
      adapter.dispose();
      container.remove();
    }
  });
  expect(result.selectionState.initiallyHidden).toEqual([null, null]);
  expect(result.selectionState.singleSelection[0]).toMatchObject({ fontSize: 12 });
  expect(result.selectionState.singleSelection[0]?.value).toBeTruthy();
  expect(result.selectionState.singleSelection[1]).toBeNull();
  for (const label of result.selectionState.multipleSelection) {
    expect(label).toMatchObject({ fontSize: 12 });
    expect(label?.value).toBeTruthy();
    expect(label?.value).not.toMatch(/[\r\n]/);
    expect(label?.height).toBeGreaterThan(0);
  }
  expect(result.selectionState.cleared).toEqual([null, null]);
  expect(result.selectionState.sameCell).toBe(true);
  expect(result.selectionState.finalGeometry).toEqual(result.selectionState.initialGeometry);
  expect(result.selectionState.unchanged).toBe(true);
  expect(result.preview.bounds).not.toEqual(result.initialBounds);
  expect(result.preview.restoredCaption).toMatchObject(result.selectionState.singleSelection[0]!);
  expect(result.preview.unselectedCaption).toBeNull();
  expect(result.preview.unchanged).toBe(true);
  expect(result.preview.selection).toHaveLength(1);
  expect(result.preview.scale).toBe(0.75);
  expect(result.preview.translate).toEqual({ x: 45, y: 60 });
  expect(result.revisionDelta).toBe(1);
  expect(result.formalParams.H).toBe(32);
  expect(result.formalPosition).toEqual({ x: 110, y: 130 });
  expect(result.finalBounds).toEqual(result.initialBounds);
  expect(result.finalCaption?.value).toBe(result.preview.restoredCaption?.value);
  expect(result.finalSelection).toEqual(result.preview.selection);
});
