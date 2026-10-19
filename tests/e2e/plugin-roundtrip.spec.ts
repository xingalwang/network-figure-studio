import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('plugin modules, distribution, child appearance and manual overrides survive the complete roundtrip', async ({
  page,
}) => {
  await page.goto('/');
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '兼容组合示例', exact: true }).click();
    await page.getByRole('button', { name: '放入画布', exact: true }).click();
    await page
      .getByTestId('graph-container')
      .click({ position: { x: 80 + i * 160, y: 130 + i * 70 } });
    await expect(page.getByRole('button', { name: '编辑生成参数', exact: true })).toBeVisible();
  }
  const original = await page.evaluate(() => window.__studio.snapshot());
  const roots = Object.values(original.entities)
    .filter((e: any) => e.kind === 'group' && e.parentId === null)
    .map((e: any) => e.id);
  expect(roots).toHaveLength(3);
  await page.locator('.tree-name').filter({ hasText: 'Residual Block' }).nth(0).click();
  await page
    .locator('.tree-name')
    .filter({ hasText: 'Residual Block' })
    .nth(1)
    .click({ modifiers: ['Shift'] });
  await page
    .locator('.tree-name')
    .filter({ hasText: 'Residual Block' })
    .nth(2)
    .click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '等距排布', exact: true }).click();
  const spaced = await page.evaluate(() => window.__studio.snapshot());
  expect(spaced.revision).toBe(original.revision + 1);
  const centers = roots
    .map((id) => spaced.entities[id].presentation.position.x + spaced.entities[id].size.width / 2)
    .sort((a, b) => a - b);
  expect(centers[1] - centers[0]).toBeCloseTo(centers[2] - centers[1]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const undone = await page.evaluate(() => window.__studio.snapshot());
  for (const id of roots)
    expect(undone.entities[id].presentation.position).toEqual(
      original.entities[id].presentation.position,
    );
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.locator('.tree-name').filter({ hasText: 'Residual Block' }).nth(0).click();
  await page.getByLabel('位置 X').fill('120');
  await page.getByLabel('位置 X').blur();
  await page.getByLabel('手工标签').fill('编码器');
  await page.getByLabel('手工标签').press('Enter');
  const before = await page.evaluate(() => window.__studio.snapshot());
  const child = Object.values(before.entities).find(
    (e: any) => e.parentId === roots[0] && e.generation?.generatorId === 'builtin.conv',
  ) as any;
  const child2 = Object.values(before.entities).find(
    (e: any) =>
      e.parentId === roots[0] && e.generation?.generatorId === 'builtin.conv' && e.id !== child.id,
  ) as any;
  const edge = Object.values(before.entities).find(
    (e: any) => e.parentId === roots[0] && e.kind === 'edge',
  ) as any;
  await page.evaluate((id) => window.__studio.select([id]), edge.id);
  await page.getByRole('button', { name: '添加折点' }).click();
  const bent = await page.evaluate(() => window.__studio.snapshot());
  await page.evaluate((id) => window.__studio.select([id]), child.id);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByLabel('表现方式').selectOption('flat');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await page.evaluate((id) => window.__studio.select([id]), child2.id);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByLabel('投影角度').fill('45');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await page.evaluate((id) => window.__studio.select([id]), roots[0]);
  await page.getByRole('button', { name: '编辑生成参数', exact: true }).click();
  await page.getByLabel('通道数', { exact: true }).fill('128');
  await page.getByRole('button', { name: '应用到原组件', exact: true }).click();
  const edited = await page.evaluate(() => window.__studio.snapshot());
  expect(edited.entities[roots[0]].presentation.position.x).toBe(120);
  expect(edited.entities[roots[0]].presentation.labelOverride).toBe('编码器');
  expect(edited.entities[edge.id].route).toEqual(bent.entities[edge.id].route);
  expect(edited.entities[child.id].primitives.some((p: any) => p.kind === 'polygon')).toBe(false);
  expect(
    edited.entities[roots[0]].generation.source.params.__slots[child2.generation.source.slotKey]
      .angleDeg,
  ).toBe(45);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载工程副本' }).click();
  const file = await download,
    path = await file.path();
  const saved = JSON.parse(await readFile(path!, 'utf8'));
  expect(saved).toEqual(edited);
  await page.getByTestId('open-project').setInputFiles(path!);
  await expect.poll(async () => page.evaluate(() => window.__studio.snapshot())).toEqual(saved);
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PNG' }).click();
  const png = await pngDownload;
  const bytes = await readFile((await png.path())!);
  expect(bytes.readUInt32BE(16)).toBe(1600);
  expect(bytes.readUInt32BE(20)).toBe(900);
});
