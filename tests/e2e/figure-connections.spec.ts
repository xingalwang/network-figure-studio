import { openWorkbench, showProjectStructure } from '../fixtures/workbench.ts';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { NodeEntity, ProjectDocument } from '../../src/core/document/types.ts';

test('v3 drawing lists only usable figures and keeps existing edges and layout when connecting', async ({
  page,
}) => {
  const doc: ProjectDocument = JSON.parse(
    await readFile('examples/projects/figure-views-demo.nnfig.json', 'utf8'),
  );
  const figures = Object.values(doc.entities).filter(
    (e): e is NodeEntity => e.kind === 'node' && e.figure?.role === 'representation',
  );
  const source = figures[0],
    target = figures[figures.length - 1],
    hidden = figures[1];
  hidden.figureState = 'hidden';
  const computationId = source.figure!.semanticRef!;
  // Old cross-workspace edges must still load and remain untouched.
  doc.entities['old-link'] = {
    id: 'old-link',
    kind: 'edge',
    parentId: null,
    name: '旧手工连线',
    source: { kind: 'port', entityId: computationId, portId: 'out' },
    target: { kind: 'port', entityId: target.id, portId: Object.keys(target.ports)[0] },
    route: { kind: 'curve', mode: 'manual', points: [{ x: 333, y: 222 }], spaceId: null },
    label: '旧连线保留',
    style: { color: '#335577', width: 2, arrow: true, dashed: true },
  };
  await openWorkbench(page);
  await page.getByTestId('open-project').setInputFiles({
    name: 'connections.nnfig.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await showProjectStructure(page);
  await page.locator(`.tree-name[data-entity-id="${source.id}"]`).click();
  await page.getByText('从此基元连接', { exact: true }).click();
  const targets = page.getByLabel('目标基元', { exact: true });
  const listed = await targets
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value).filter(Boolean),
    );
  expect(listed).not.toContain(computationId);
  expect(listed).not.toContain(hidden.id);
  expect(listed).not.toContain(source.id);
  expect(listed).toContain(target.id);
  for (const id of listed) {
    const entity = doc.entities[id];
    expect(entity.kind !== 'edge' && !('semantic' in entity && entity.semantic)).toBe(true);
    expect(entity.kind !== 'edge' && Object.keys(entity.ports).length > 0).toBe(true);
  }
  await targets.selectOption(target.id);
  const before: ProjectDocument = await page.evaluate(() => window.__studio.snapshot());
  await page.getByRole('button', { name: '添加连接', exact: true }).click();
  await expect
    .poll(
      async () =>
        Object.keys((await page.evaluate(() => window.__studio.snapshot())).entities).length,
    )
    .toBe(Object.keys(before.entities).length + 1);
  const after: ProjectDocument = await page.evaluate(() => window.__studio.snapshot());
  for (const [id, entity] of Object.entries(before.entities))
    expect(after.entities[id]).toEqual(entity);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__studio.snapshot().entities))
    .toEqual(before.entities);
  // Changing the current target after selection invalidates it without choosing another object.
  await targets.selectOption(target.id);
  await page.evaluate(async (id) => {
    const current = window.__studio.snapshot();
    const result = await window.__studio.dispatch({
      baseRevision: current.revision,
      operations: [{ kind: 'put', entity: { ...current.entities[id], figureState: 'hidden' } }],
    });
    if (!result.ok) throw Error(result.error.message);
  }, target.id);
  await expect(targets).toHaveValue('');
  await expect(page.getByRole('button', { name: '添加连接', exact: true })).toBeDisabled();
});
