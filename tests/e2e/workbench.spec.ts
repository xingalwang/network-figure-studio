import { test, expect } from '@playwright/test';

test('entering tensor commands confirms a changed legacy draft before creating visible data', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '兼容组合示例', exact: true }).click();
  await page.getByRole('button', { name: '放入画布', exact: true }).click();
  await page.getByTestId('graph-container').click({ position: { x: 120, y: 180 } });
  await page.getByRole('button', { name: '编辑生成参数', exact: true }).click();
  await page.getByLabel('通道数', { exact: true }).fill('96');
  const before = await page.evaluate(() => window.__studio.snapshot());
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '2D 数据', exact: true }).click();
  expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(before);
  await expect(page.getByRole('button', { name: '应用到原组件', exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '2D 数据', exact: true }).click();
  await expect(page.locator('.tensor-stage')).toBeVisible();
  await expect(page.getByRole('button', { name: '应用到原组件', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '参数', exact: true }).click();
  await expect(page.getByLabel('高度 H', { exact: true })).toBeVisible();
  await expect(page.getByLabel('深度 D', { exact: true })).toHaveCount(0);
});

test('workbench commands, independent persistent themes, and parameter drafts', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('toolbar', { name: '生成命令带' })).toBeVisible();
  await expect(page.getByRole('button', { name: '卷积', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '添加3D数据块', exact: true }).click();
  await page.getByRole('button', { name: '参数', exact: true }).click();
  await page.getByLabel('深度 D', { exact: true }).fill('128');
  const before = await page.evaluate(() => window.__studio.snapshot());
  await page.getByLabel('界面主题', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByLabel('深度 D', { exact: true })).toHaveValue('128');
  expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(before);
  await page.getByLabel('界面主题', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(before);
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('界面主题', { exact: true })).toHaveValue('dark');
});

test('2D workbench computes pooling and activation, and exports identical vectors in either theme', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '2D 数据', exact: true }).click();
  await page.getByRole('button', { name: '参数', exact: true }).click();
  await expect(page.getByLabel('深度 D', { exact: true })).toHaveCount(0);
  for (const label of ['高度 H', '宽度 W'])
    await page.getByLabel(label, { exact: true }).fill('32');
  await page.getByLabel('通道 C', { exact: true }).fill('3');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await page.getByRole('button', { name: '卷积', exact: true }).click();
  await page.getByLabel('输出通道', { exact: true }).fill('8');
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  await expect(page.locator('.right-panel')).toContainText('224');
  await expect(page.locator('.right-panel')).toContainText('C8');
  await page.getByRole('button', { name: '池化', exact: true }).click();
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  await page.getByRole('button', { name: '激活', exact: true }).click();
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  await page.getByRole('button', { name: '上采样', exact: true }).click();
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  const shapes = await page.evaluate(() => window.__studio.analysis());
  expect(
    Object.values(shapes.nodes).some(
      (n: any) => n.shape?.H === 32 && n.shape?.W === 32 && n.shape?.C === 8 && !('D' in n.shape),
    ),
  ).toBe(true);
  await expect(page.getByRole('region', { name: '计算摘要' })).toContainText('ReLU');
  await page.getByRole('button', { name: '加入图稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '导出', exact: true })).toBeEnabled();
  const vectors: string[] = [];
  for (const theme of ['dark', 'light']) {
    await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByLabel('嵌入字体', { exact: true }).uncheck();
    const ready = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 SVG', exact: true }).click();
    const file = await ready;
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    vectors.push(Buffer.concat(chunks).toString('utf8'));
    await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  }
  expect(vectors[0]).toBe(vectors[1]);
  expect(vectors[0]).toContain('ReLU');
  expect(vectors[0]).not.toContain('undefined');
});
