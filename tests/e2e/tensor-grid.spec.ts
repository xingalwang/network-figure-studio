import { openWorkbench, useModuleTool, switchWorkspace } from '../fixtures/workbench.ts';
import { expect, test, type Page } from '@playwright/test';
import type { NodeEntity, ProjectDocument } from '../../src/core/document/types.ts';
const snapshot = (page: Page): Promise<ProjectDocument> =>
  page.evaluate(() => window.__studio.snapshot());
const sourceOf = (doc: ProjectDocument) =>
  Object.values(doc.entities).find(
    (entity): entity is NodeEntity =>
      entity.kind === 'node' && entity.semantic?.role === 'tensor-source',
  )!;
const gridLines = (node: NodeEntity) =>
  node.primitives.filter((p) => p.kind === 'polygon' && p.strokeWidth === 0 && p.opacity === 0.55)
    .length;
async function fillSource(
  page: Page,
  values = { '批量 N': '1', '高度 H': '12', '宽度 W': '10', '通道 C': '4' },
) {
  await page.getByRole('button', { name: '参数', exact: true }).click();
  for (const [label, value] of Object.entries(values))
    await page.getByLabel(label, { exact: true }).fill(value);
}
const front = (page: Page) => page.locator('.graph-container svg rect[fill="#a9cad9"]').first();

test('draft shape resizes the live grid while display multipliers apply independently from structure builds', async ({
  page,
}) => {
  await openWorkbench(page);
  await useModuleTool(page, '添加2D数据块');
  const before = await snapshot(page);
  await fillSource(page);
  await expect(page.getByTestId('graph-container')).not.toContainText('W 10');
  await expect(page.getByRole('region', { name: '数据块信息' })).toContainText(
    'N 1 · H 12 · W 10 · C 4',
  );
  await expect(front(page)).toBeVisible();
  const firstWidth = Number(await front(page).getAttribute('width'));
  await page.getByLabel('宽度 W', { exact: true }).fill('20');
  await expect
    .poll(async () => Number(await front(page).getAttribute('width')))
    .toBeCloseTo(firstWidth * 2, 1);
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: '构建', exact: true }).click();
  const built = await snapshot(page);
  expect(built.revision).toBe(before.revision + 1);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await expect(page.getByLabel('组装显示模式')).toHaveValue('auto');
  await expect(page.getByLabel('C 轴显示倍率')).toBeVisible();
  await expect(page.getByLabel('D 轴显示倍率')).toHaveCount(0);
  await page.getByLabel('整体显示倍率').fill('2');
  await page.getByLabel('W 轴显示倍率').fill('0.5');
  await expect(page.getByRole('button', { name: '构建', exact: true })).toBeDisabled();
  expect(await snapshot(page)).toEqual(built);
  const oldHeight = Number(await front(page).getAttribute('height'));
  await page.getByRole('button', { name: '应用外观', exact: true }).click();
  await expect
    .poll(async () => Number(await front(page).getAttribute('height')))
    .toBeCloseTo(oldHeight * 2, 1);
  expect(sourceOf(await snapshot(page)).generation?.source).toMatchObject({
    params: { H: 12, W: 20, displayScale: 2, displayW: 0.5 },
  });
  await page.getByLabel('整体显示倍率').fill('4');
  await page.getByLabel('W 轴显示倍率').fill('4');
  await page.getByRole('button', { name: '应用外观', exact: true }).click();
  await expect(page.getByTestId('graph-container')).not.toContainText('压缩示意');
  await expect(page.getByRole('region', { name: '数据块信息' })).toContainText('压缩示意');
});

test('new drawings freeze grids, retain them through structure edits, manual resizing and save reopening', async ({
  page,
}) => {
  page.on('dialog', (dialog) => dialog.accept());
  await openWorkbench(page);
  await useModuleTool(page, '添加2D数据块');
  await fillSource(page);
  await page.getByRole('button', { name: '构建', exact: true }).click();
  const sourceId = sourceOf(await snapshot(page)).id;
  await page.getByRole('button', { name: '加入图稿', exact: true }).click();
  const initial = sourceOf(await snapshot(page));
  expect(initial.size).toEqual({ width: 20, height: 24 });
  expect(gridLines(initial)).toBeGreaterThan(0);
  await switchWorkspace(page, '组装');
  await page.evaluate((id) => window.__studio.select([id]), sourceId);
  await page.getByRole('button', { name: '参数', exact: true }).click();
  await page.getByLabel('高度 H', { exact: true }).fill('24');
  await page.getByRole('button', { name: '构建', exact: true }).click();
  expect(sourceOf(await snapshot(page)).primitives).toEqual(initial.primitives);
  expect(sourceOf(await snapshot(page)).size).toEqual(initial.size);
  await page.getByRole('button', { name: '更新图稿', exact: true }).click();
  await page.getByRole('button', { name: '独立标注', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).schemaVersion).toBe(3);
  const migrated = await snapshot(page),
    representation = Object.values(migrated.entities).find(
      (entity) => entity.figure?.semanticRef === sourceId,
    )!;
  await page.evaluate((id) => window.__studio.select([id]), representation.id);
  await page.getByRole('button', { name: '新增图稿表示', exact: true }).click();
  await expect
    .poll(
      async () =>
        Object.values((await snapshot(page)).entities).filter(
          (entity) => entity.figure?.semanticRef === sourceId,
        ).length,
    )
    .toBe(2);
  const added = Object.values((await snapshot(page)).entities).find(
    (entity): entity is NodeEntity =>
      entity.kind === 'node' &&
      entity.id !== representation.id &&
      entity.figure?.semanticRef === sourceId,
  )!;
  expect(added.size).toEqual({ width: 20, height: 48 });
  const count = gridLines(added);
  expect(count).toBeGreaterThan(0);
  for (const [label, value] of Object.entries({
    '显示宽度 px': '80',
    '显示高度 px': '60',
    '视觉厚度 px': '30',
    '投影角度 °': '45',
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: '应用图稿外观', exact: true }).click();
  const saved = await snapshot(page),
    adjusted = saved.entities[added.id] as NodeEntity;
  expect(adjusted.size).toEqual({ width: 80, height: 60 });
  expect(gridLines(adjusted)).toBe(count);
  expect(saved.entities[representation.id]).toEqual(migrated.entities[representation.id]);
  await page.getByTestId('open-project').setInputFiles({
    name: 'grid.nnfig.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect.poll(() => snapshot(page)).toEqual(saved);
  const exported = await page.evaluate(async () => {
    const svg = await window.__studio.exportSvg(window.__studio.snapshot(), {
      range: 'content',
      margin: 20,
      background: 'white',
      width: 1000,
      height: 600,
      embedFonts: false,
    });
    const xml = new DOMParser().parseFromString(await svg.text(), 'image/svg+xml');
    return {
      paths: xml.querySelectorAll('path').length,
      text: [...xml.querySelectorAll('text')].map((node) => node.textContent).join(''),
    };
  });
  expect(exported.paths).toBeGreaterThan(30);
  expect(exported.text).toContain('W 10 · H 24 · C 4');
});
