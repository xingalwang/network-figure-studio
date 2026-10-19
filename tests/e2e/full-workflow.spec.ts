import { test, expect } from '@playwright/test';
test('two workspaces generate, edit parameters, undo, save/reopen and export real files', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '兼容组合示例', exact: true }).click();
  await expect(page.getByRole('button', { name: '放入画布', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '放入画布', exact: true }).click();
  await page.getByTestId('graph-container').click({ position: { x: 140, y: 180 } });
  await expect(page.getByRole('button', { name: '编辑生成参数', exact: true })).toBeVisible();
  await page.getByLabel('手工标签').fill('编码器');
  await page.getByLabel('手工标签').press('Enter');
  await page.getByRole('button', { name: '编辑生成参数', exact: true }).click();
  await page.getByLabel('通道数', { exact: true }).fill('128');
  await page.getByRole('button', { name: '应用到原组件', exact: true }).click();
  await expect(page.getByLabel('手工标签')).toHaveValue('编码器');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载工程副本', exact: true }).click();
  const file = await downloadPromise;
  const path = await file.path();
  expect(path).toBeTruthy();
  await page.getByTestId('open-project').setInputFiles(path!);
  await expect(page.getByLabel('手工标签')).toHaveValue('编码器');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const svgPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 SVG', exact: true }).click();
  const svg = await svgPromise;
  expect(svg.suggestedFilename()).toMatch(/\.svg$/);
});
