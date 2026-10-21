import { expect, test, type Page } from '@playwright/test';
import type { NodeEntity, ProjectDocument } from '../../src/core/document/types.ts';
import { moduleTool, openWorkbench, switchWorkspace } from '../fixtures/workbench.ts';

const snapshot = (page: Page): Promise<ProjectDocument> =>
  page.evaluate(() => window.__studio.snapshot());
const point = (page: Page, id: string) =>
  page.evaluate((id) => window.__studio.screenPoint(id), id);
const nodes = (doc: ProjectDocument) =>
  Object.values(doc.entities).filter((entity): entity is NodeEntity => entity.kind === 'node');

async function drop(page: Page, name: string, x: number, y: number) {
  const before = await snapshot(page);
  await (
    await moduleTool(page, name)
  ).dragTo(page.getByTestId('graph-container'), {
    targetPosition: { x, y },
  });
  await expect.poll(async () => nodes(await snapshot(page)).length).toBe(nodes(before).length + 1);
  return nodes(await snapshot(page)).find((entity) => !before.entities[entity.id])!;
}
async function select(page: Page, id: string, twice = false) {
  const position = await point(page, id);
  if (twice) await page.mouse.dblclick(position.x, position.y);
  else await page.mouse.click(position.x, position.y);
}

test('mixed assembly keeps one host, subsequent operations, editing and viewport', async ({
  page,
}) => {
  await openWorkbench(page);
  const source = await drop(page, '添加2D数据块', 170, 170);
  await select(page, source.id, true);
  for (const [name, value] of [
    ['高度 H', '24'],
    ['宽度 W', '16'],
    ['通道 C', '3'],
  ] as const)
    await page.getByLabel(name, { exact: true }).fill(value);
  await page.getByRole('button', { name: '构建', exact: true }).click();

  const host = page.getByTestId('graph-container');
  await host.evaluate((element) => element.setAttribute('data-assembly-host', 'same'));
  await host.hover({ position: { x: 300, y: 400 } });
  await page.mouse.wheel(0, -120);
  const sourceBefore = await point(page, source.id);
  const primitive = await drop(page, '添加输入特征', 470, 240);
  await expect(host).toHaveAttribute('data-assembly-host', 'same');
  expect(await point(page, source.id)).toEqual(sourceBefore);

  await select(page, primitive.id, true);
  await expect(page.getByLabel('标签', { exact: true })).toBeFocused();
  await page.getByLabel('标签', { exact: true }).fill('Pending input');
  await select(page, source.id, true);
  await expect(page.getByLabel('高度 H', { exact: true })).toHaveValue('24');
  await expect(page.getByRole('button', { name: '添加后续操作', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加后续操作', exact: true }).click();
  await page
    .locator('.tensor-operation-menu')
    .getByRole('button', { name: 'ReLU', exact: true })
    .click();
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  await expect.poll(async () => nodes(await snapshot(page)).length).toBe(4);
  await expect(host).toHaveAttribute('data-assembly-host', 'same');

  await select(page, primitive.id, true);
  await expect(page.getByLabel('标签', { exact: true })).toHaveValue('Pending input');
  const beforeBuild = await snapshot(page);
  await page.getByRole('button', { name: '构建', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).revision).toBe(beforeBuild.revision + 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await snapshot(page)).entities[primitive.id]).toEqual(beforeBuild.entities[primitive.id]);

  const beforeSwitch = await point(page, source.id);
  await switchWorkspace(page, '图稿');
  await switchWorkspace(page, '组装');
  expect(await point(page, source.id)).toEqual(beforeSwitch);
  await select(page, source.id);
  await expect(page.getByRole('button', { name: '添加后续操作', exact: true })).toBeVisible();
});

test('assembly select and connect tools match actual port behavior for free primitives', async ({
  page,
}) => {
  await openWorkbench(page);
  const first = await drop(page, '添加输入特征', 170, 160);
  const second = await drop(page, '添加卷积层', 470, 260);
  const ports = () =>
    page.evaluate(
      ([source, target]) => [
        window.__studio.portPoint(source, 'out'),
        window.__studio.portPoint(target, 'in'),
      ],
      [first.id, second.id],
    );
  const gesture = async () => {
    const positions = await ports();
    await page.mouse.move(positions[0].x, positions[0].y);
    await page.mouse.down();
    await page.mouse.move(positions[1].x, positions[1].y, { steps: 15 });
    await page.mouse.up();
  };
  await expect(page.getByRole('button', { name: '选择', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const beforeSelection = await snapshot(page);
  await gesture();
  await expect.poll(async () => (await snapshot(page)).revision).toBe(beforeSelection.revision + 1);
  await expect
    .poll(
      async () =>
        Object.values((await snapshot(page)).entities).filter((entity) => entity.kind === 'edge')
          .length,
    )
    .toBe(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const afterSelection = await snapshot(page);
  await page.getByRole('button', { name: '连线', exact: true }).click();
  await expect(page.getByRole('button', { name: '连线', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await gesture();
  await expect
    .poll(
      async () =>
        Object.values((await snapshot(page)).entities).filter((entity) => entity.kind === 'edge')
          .length,
    )
    .toBe(1);
  const edge = Object.values((await snapshot(page)).entities).find(
    (entity) => entity.kind === 'edge',
  )!;
  expect(edge).toMatchObject({
    meaning: 'annotation',
    source: { kind: 'port', entityId: first.id, portId: 'out' },
    target: { kind: 'port', entityId: second.id, portId: 'in' },
  });
  expect((await snapshot(page)).revision).toBe(afterSelection.revision + 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(
    Object.values((await snapshot(page)).entities).filter((entity) => entity.kind === 'edge'),
  ).toHaveLength(0);
});
