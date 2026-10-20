import { expect, test } from '@playwright/test';
import type { NodeEntity, ProjectDocument } from '../../src/core/document/types.ts';

const snapshot = (page: import('@playwright/test').Page): Promise<ProjectDocument> =>
  page.evaluate(() => window.__studio.snapshot());

test('registered operation and independent drawing actions round-trip through the real workbench', async ({
  page,
}) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await page.getByRole('button', { name: '2D 数据', exact: true }).click();
  const source = Object.values((await snapshot(page)).entities).find(
    (e): e is NodeEntity => e.kind === 'node' && e.semantic?.role === 'tensor-source',
  )!;
  await page.getByRole('button', { name: '参数', exact: true }).click();
  for (const [label, value] of Object.entries({
    '批量 N': '1',
    '高度 H': '8',
    '宽度 W': '8',
    '通道 C': '4',
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await page.getByRole('button', { name: 'LeakyReLU', exact: true }).click();
  await page.getByLabel('负半轴斜率 alpha', { exact: true }).fill('0.2');
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  const operation = Object.values((await snapshot(page)).entities).find(
    (e): e is NodeEntity => e.kind === 'node' && e.generation?.generatorId === 'example.leaky-relu',
  )!;
  expect(operation.generation?.source).toMatchObject({ params: { alpha: 0.2, dimension: 2 } });
  await expect
    .poll(() => page.evaluate((id) => window.__studio.analysis().nodes[id].shape, operation.id))
    .toEqual({ N: 1, H: 8, W: 8, C: 4 });
  await page.getByRole('button', { name: '加入图稿', exact: true }).click();
  const legacy = await snapshot(page);
  await page.getByRole('button', { name: '独立标注', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).schemaVersion).toBe(3);
  const migrated = await snapshot(page);
  expect(migrated.id).not.toBe(legacy.id);
  expect(migrated.entities[source.id]).toEqual(legacy.entities[source.id]);
  await page.getByLabel('标注内容', { exact: true }).fill('Encoder 编码器');
  await page.getByRole('button', { name: '应用标注', exact: true }).click();
  await expect(page.getByTestId('graph-container')).toContainText('Encoder 编码器');
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('标注内容', { exact: true })).toHaveValue('说明');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByLabel('标注内容', { exact: true })).toHaveValue('Encoder 编码器');
  const representation = Object.values((await snapshot(page)).entities).find(
    (e) => e.figure?.role === 'representation' && e.figure.semanticRef === source.id,
  )!;
  await page.evaluate((id) => window.__studio.select([id]), representation.id);
  await page.getByRole('button', { name: '新增图稿表示', exact: true }).click();
  const independent = Object.values((await snapshot(page)).entities).find(
    (e) => e.id !== representation.id && e.figure?.semanticRef === source.id,
  )!;
  for (const [label, value] of Object.entries({
    '显示宽度 px': '224',
    '显示高度 px': '64',
    '视觉厚度 px': '52',
    '投影角度 °': '60',
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: '应用图稿外观', exact: true }).click();
  const after = await snapshot(page);
  expect(
    Object.values(after.entities).filter((e) => e.figure?.semanticRef === source.id),
  ).toHaveLength(2);
  expect(after.entities[source.id]).toEqual(legacy.entities[source.id]);
  expect(after.entities[representation.id]).toEqual(migrated.entities[representation.id]);
  expect(after.entities[independent.id]).toMatchObject({
    size: { width: 224, height: 64 },
    figure: { tensorProjection: { depth: 52, angleDeg: 60 } },
  });
  const figures = Object.values(after.entities).filter((e) => e.figure);
  // A structure update must preserve every existing drawing object byte for byte.
  await page.getByRole('button', { name: '更新图稿', exact: true }).click();
  const updated = await snapshot(page);
  for (const entity of figures) expect(updated.entities[entity.id]).toEqual(entity);
  await page.getByRole('button', { name: '导出图稿', exact: true }).click();
  await expect(page.getByAltText('导出预览')).toBeVisible();
  const svgDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 SVG', exact: true }).click();
  const svg = await (await svgDownload).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of svg!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString('utf8')).toContain('Encoder 编码器');
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PNG', exact: true }).click();
  const png = await (await pngDownload).createReadStream();
  const bytes: Buffer[] = [];
  for await (const chunk of png!) bytes.push(Buffer.from(chunk));
  expect(Buffer.concat(bytes).subarray(1, 4).toString()).toBe('PNG');
  await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  const saved = await snapshot(page);
  await page.getByText('文件', { exact: true }).click();
  const projectDownload = page.waitForEvent('download');
  await page.locator('header').getByRole('button', { name: '下载工程副本', exact: true }).click();
  const file = await projectDownload;
  await page.getByTestId('open-project').setInputFiles((await file.path())!);
  await expect.poll(() => snapshot(page)).toEqual(saved);
  await expect(page.getByTestId('graph-container')).toContainText('Encoder 编码器');
});
