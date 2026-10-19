import { test, expect } from '@playwright/test';
test('real canvas drag commits once and preserves anchored ports and bends', async ({ page }) => {
  await page.goto('/__test__/canvas');
  await expect(page.getByTestId('graph-container')).toBeVisible();
  const before = await page.evaluate(() => window.__studio.snapshot());
  const p = await page.evaluate(() => window.__studio.screenPoint('node-a'));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 75, p.y + 35, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => page.evaluate(() => window.__studio.snapshot().revision))
    .toBe(before.revision + 1);
  const after = await page.evaluate(() => window.__studio.snapshot());
  expect(after.entities['node-a'].presentation.position).not.toEqual(
    before.entities['node-a'].presentation.position,
  );
  expect(after.entities['edge'].target).toEqual(before.entities['edge'].target);
  expect(after.entities['edge'].route.points).toEqual(before.entities['edge'].route.points);
});
test('reconnecting the actual endpoint handle changes only the target port', async ({ page }) => {
  await page.goto('/__test__/canvas');
  await page.waitForFunction(() => !!window.__studio);
  await page.evaluate(async () => {
    const d = window.__studio.snapshot();
    const node = structuredClone(d.entities['node-b']);
    node.id = 'node-c';
    node.presentation.position = { x: 650, y: 160 };
    await window.__studio.dispatch({
      baseRevision: d.revision,
      operations: [{ kind: 'put', entity: node }],
    });
    window.__studio.select(['edge']);
  });
  const points = await page.evaluate(() => {
    const graph = window.__studio.graph,
      state = graph.getView().getState(graph.getDataModel().getCell('edge')),
      r = graph.container.getBoundingClientRect();
    const end = state.absolutePoints.at(-1);
    return {
      from: { x: end.x + r.left, y: end.y + r.top },
      to: { x: 650 + r.left, y: 190 + r.top },
    };
  });
  await page.mouse.move(points.from.x, points.from.y);
  await page.mouse.down();
  await page.mouse.move(points.to.x, points.to.y, { steps: 15 });
  await page.mouse.up();
  await expect
    .poll(async () => page.evaluate(() => window.__studio.snapshot().entities.edge.target))
    .toEqual({ kind: 'port', entityId: 'node-c', portId: 'in' });
});
test('a real bend handle creates one manual-route transaction', async ({ page }) => {
  await page.goto('/__test__/canvas');
  await page.waitForFunction(() => !!window.__studio);
  await page.evaluate(async () => {
    const d = window.__studio.snapshot();
    await window.__studio.dispatch({
      baseRevision: d.revision,
      operations: [
        { kind: 'route', id: 'edge', route: { ...d.entities.edge.route, kind: 'straight' } },
      ],
    });
    window.__studio.select(['edge']);
  });
  const origin = await page.getByTestId('graph-container').boundingBox();
  await page.mouse.move(origin!.x + 280, origin!.y + 100);
  await page.mouse.down();
  await page.mouse.move(origin!.x + 300, origin!.y + 70, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => window.__studio.snapshot().revision)).toBe(2);
  const edge = await page.evaluate(() => window.__studio.snapshot().entities.edge);
  expect(edge.route.mode).toBe('manual');
  expect(edge.route.points).not.toEqual([{ x: 280, y: 100 }]);
});
test('initial projection resolves ports before drawing edges behind nodes', async ({ page }) => {
  await page.goto('/__test__/canvas');
  await page.waitForFunction(() => !!window.__studio);
  const points = await page.evaluate(() => {
    const g = window.__studio.graph,
      edge = g.view.getState(g.getDataModel().getCell('edge'));
    return edge.absolutePoints.map((p: any) => ({ x: p.x, y: p.y }));
  });
  expect(Math.abs(points.at(-1).x - 400)).toBeLessThanOrEqual(4);
  expect(Math.abs(points.at(-1).y - 190)).toBeLessThanOrEqual(4);
});
test('projection failure rebuilds the committed document without creating another revision', async ({
  page,
}) => {
  await page.goto('/__test__/canvas');
  await page.waitForFunction(() => !!window.__studio);
  const result = await page.evaluate(async () => {
    const g = window.__studio.graph,
      insert = g.insertVertex.bind(g);
    let once = true;
    g.insertVertex = (...args: any[]) => {
      if (once) {
        once = false;
        throw Error('test projection failure');
      }
      return insert(...args);
    };
    const d = window.__studio.snapshot();
    const commit = await window.__studio.dispatch({
      baseRevision: d.revision,
      operations: [{ kind: 'move', id: 'node-a', position: { x: 140, y: 200 } }],
    });
    return {
      ok: commit.ok,
      revision: window.__studio.snapshot().revision,
      x: g.getDataModel().getCell('node-a')?.geometry.x,
      enabled: g.isEnabled(),
    };
  });
  expect(result).toEqual({ ok: true, revision: 1, x: 140, enabled: true });
});
test('drawing between real port handles creates a document connection', async ({ page }) => {
  await page.goto('/__test__/canvas');
  await page.waitForFunction(() => !!window.__studio);
  const handles = await page.evaluate(() => {
    const g = window.__studio.graph,
      r = g.container.getBoundingClientRect();
    return ['node-a:port:out', 'node-b:port:in'].map((id) => {
      const s = g.view.getState(g.getDataModel().getCell(id));
      return { x: r.left + s.x + s.width / 2, y: r.top + s.y + s.height / 2 };
    });
  });
  await page.mouse.move(handles[0].x, handles[0].y);
  await page.mouse.down();
  await page.mouse.move(handles[1].x, handles[1].y, { steps: 15 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          Object.values(window.__studio.snapshot().entities).filter((e: any) => e.kind === 'edge')
            .length,
      ),
    )
    .toBe(2);
  const created = await page.evaluate(
    () =>
      Object.values(window.__studio.snapshot().entities).find(
        (e: any) => e.kind === 'edge' && e.id !== 'edge',
      ) as any,
  );
  expect(created.source).toEqual({ kind: 'port', entityId: 'node-a', portId: 'out' });
  expect(created.target).toEqual({ kind: 'port', entityId: 'node-b', portId: 'in' });
});
test('public group ports remain reachable over their generated child ports', async ({ page }) => {
  await page.goto('/__test__/canvas');
  await page.waitForFunction(() => !!window.__studio);
  await page.evaluate(async () => {
    const d = window.__studio.snapshot();
    const operations = ['node-a', 'node-b'].flatMap((id, index) => {
      const node = structuredClone(d.entities[id]),
        groupId = `group-${index}`;
      const group = {
        id: groupId,
        parentId: null,
        kind: 'group',
        name: '生成组合',
        size: { width: 100, height: 100 },
        presentation: { position: { ...node.presentation.position } },
        ports: { in: { entityId: id, portId: 'in' }, out: { entityId: id, portId: 'out' } },
        generation: {
          generatorId: 'test.group',
          version: '1.0.0',
          paramSchemaVersion: 1,
          source: { kind: 'local', params: {} },
          localKeys: { root: groupId, node: id },
        },
      };
      node.parentId = groupId;
      node.presentation.position = { x: 0, y: 0 };
      return [
        { kind: 'put', entity: group },
        { kind: 'put', entity: node },
      ];
    });
    const r = await window.__studio.dispatch({ baseRevision: d.revision, operations });
    if (!r.ok) throw Error(r.error.message);
  });
  const handles = await page.evaluate(() => {
    const g = window.__studio.graph,
      r = g.container.getBoundingClientRect();
    return ['group-0:port:out', 'group-1:port:in'].map((id) => {
      const s = g.view.getState(g.getDataModel().getCell(id));
      return { x: r.left + s.x + s.width / 2, y: r.top + s.y + s.height / 2 };
    });
  });
  await page.mouse.move(handles[0].x, handles[0].y);
  await page.mouse.down();
  await page.mouse.move(handles[1].x, handles[1].y, { steps: 15 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          Object.values(window.__studio.snapshot().entities).filter((e: any) => e.kind === 'edge')
            .length,
      ),
    )
    .toBe(2);
  const created = await page.evaluate(
    () =>
      Object.values(window.__studio.snapshot().entities).find(
        (e: any) => e.kind === 'edge' && e.id !== 'edge',
      ) as any,
  );
  expect(created.source).toEqual({ kind: 'port', entityId: 'group-0', portId: 'out' });
  expect(created.target).toEqual({ kind: 'port', entityId: 'group-1', portId: 'in' });
});
test('port anchors stay aligned after zooming and translating the view', async ({ page }) => {
  await page.goto('/__test__/canvas');
  await page.waitForFunction(() => !!window.__studio);
  const distances = await page.evaluate(() => {
    const graph = window.__studio.graph;
    graph.view.scaleAndTranslate(0.7, 230, 110);
    const edge = graph.view.getState(graph.model.getCell('edge'));
    return ['node-a:port:out', 'node-b:port:in'].map((id, index) => {
      const port = graph.view.getState(graph.model.getCell(id));
      const end = index ? edge.absolutePoints.at(-1) : edge.absolutePoints[0];
      return Math.hypot(end.x - port.getCenterX(), end.y - port.getCenterY());
    });
  });
  expect(Math.max(...distances)).toBeLessThanOrEqual(3);
});
