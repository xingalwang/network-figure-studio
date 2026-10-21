import {
  openWorkbench,
  continueFromWelcome,
  moduleTool,
  useModuleTool,
  switchWorkspace,
} from '../fixtures/workbench.ts';
import { test, expect } from '@playwright/test';

test('entering tensor commands retains existing primitive drafts until the shared build', async ({
  page,
}) => {
  await openWorkbench(page);
  await useModuleTool(page, '使用Residual Block');
  await page.getByRole('button', { name: '放入画布', exact: true }).click();
  await page.getByTestId('graph-container').click({ position: { x: 120, y: 180 } });
  await page.getByRole('button', { name: '编辑生成参数', exact: true }).click();
  await page.getByLabel('通道数', { exact: true }).fill('96');
  const before = await page.evaluate(() => window.__studio.snapshot());
  const root = Object.values(before.entities).find(
    (entity: any) => entity.kind === 'group' && entity.parentId === null,
  ) as any;
  await switchWorkspace(page, '组装');
  await useModuleTool(page, '添加2D数据块');
  await expect(page.locator('.tensor-stage')).toBeVisible();
  expect((await page.evaluate(() => window.__studio.snapshot())).entities[root.id]).toEqual(root);
  await expect(page.getByRole('button', { name: '构建', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '构建', exact: true }).click();
  expect(
    (await page.evaluate(() => window.__studio.snapshot())).entities[root.id].generation.source
      .params.channels,
  ).toBe(96);
  await page.getByRole('button', { name: '参数', exact: true }).click();
  await expect(page.getByLabel('高度 H', { exact: true })).toBeVisible();
  await expect(page.getByLabel('深度 D', { exact: true })).toHaveCount(0);
});

test('cancelling a data command keeps an unplaced legacy draft and its workspace', async ({
  page,
}) => {
  await openWorkbench(page);
  await useModuleTool(page, '使用Residual Block');
  await page.getByLabel('通道数', { exact: true }).fill('96');
  const before = await page.evaluate(() => window.__studio.snapshot());
  page.once('dialog', (dialog) => dialog.dismiss());
  await useModuleTool(page, '添加2D数据块');
  await expect(page.getByRole('button', { name: '放入画布', exact: true })).toBeVisible();
  await expect(page.getByLabel('通道数', { exact: true })).toHaveValue('96');
  expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(before);
});

test('drawing limits creation tools and returning to assembly respects the pending legacy draft', async ({
  page,
}) => {
  await openWorkbench(page);
  await useModuleTool(page, '添加2D数据块');
  await useModuleTool(page, '使用Residual Block');
  await page.getByLabel('通道数', { exact: true }).fill('96');
  await switchWorkspace(page, '图稿');
  const before = await page.evaluate(() => window.__studio.snapshot());
  await expect(page.getByRole('button', { name: '使用Conv2D', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '添加2D数据块', exact: true })).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.dismiss());
  await switchWorkspace(page, '组装');
  await expect(page.getByRole('toolbar', { name: '图稿通用工具' })).toBeVisible();
  expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(before);
  page.once('dialog', (dialog) => dialog.accept());
  await switchWorkspace(page, '组装');
  await expect(page.getByRole('toolbar', { name: '组装通用工具' })).toBeVisible();
  await expect(page.locator('.tensor-stage')).toBeVisible();
  expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(before);
});

test('declining a v1 upgrade keeps the legacy editor and existing project intact', async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, 'locks', { value: undefined }),
  );
  await openWorkbench(page);
  await page
    .getByTestId('open-project')
    .setInputFiles('examples/projects/residual-demo.nnfig.json');
  await expect(page.getByLabel('项目名称', { exact: true })).toHaveValue(/残差块/);
  await switchWorkspace(page, '组装');
  await useModuleTool(page, '使用Residual Block');
  await page.getByLabel('项目名称', { exact: true }).fill('未保存的 v1 工程');
  await page.getByLabel('项目名称', { exact: true }).blur();
  const before = await page.evaluate(() => window.__studio.snapshot());
  page.once('dialog', (dialog) => dialog.dismiss());
  await useModuleTool(page, '添加2D数据块');
  await expect(page.getByRole('button', { name: '放入画布', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(before);
});

test('workbench commands, independent persistent themes, and parameter drafts', async ({
  page,
}) => {
  await openWorkbench(page);
  await expect(page.getByRole('toolbar', { name: '组装通用工具' })).toBeVisible();
  await expect(await moduleTool(page, '使用Conv3D')).toBeDisabled();
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
  await continueFromWelcome(page);
  await expect(page.getByLabel('界面主题', { exact: true })).toHaveValue('dark');
});

test('2D workbench computes pooling and activation, and exports identical vectors in either theme', async ({
  page,
}) => {
  await openWorkbench(page);
  await useModuleTool(page, '添加2D数据块');
  await page.getByRole('button', { name: '参数', exact: true }).click();
  await expect(page.getByLabel('深度 D', { exact: true })).toHaveCount(0);
  for (const label of ['高度 H', '宽度 W'])
    await page.getByLabel(label, { exact: true }).fill('32');
  await page.getByLabel('通道 C', { exact: true }).fill('3');
  await page.getByRole('button', { name: '构建', exact: true }).click();
  await useModuleTool(page, '使用Conv2D');
  await page.getByLabel('输出通道', { exact: true }).fill('8');
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  await expect(page.locator('.right-panel')).toContainText('224');
  await expect(page.getByRole('region', { name: '数据块信息', exact: true })).toContainText('C 8');
  await expect(page.locator('math[aria-label="输出"]')).toBeVisible();
  await useModuleTool(page, '使用MaxPool2D');
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  await useModuleTool(page, '使用ReLU');
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  await useModuleTool(page, '使用最近邻上采样');
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  const shapes = await page.evaluate(() => window.__studio.analysis());
  expect(
    Object.values(shapes.nodes).some(
      (n: any) => n.shape?.H === 32 && n.shape?.W === 32 && n.shape?.C === 8 && !('D' in n.shape),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '计算摘要', exact: true }).click();
  await expect(page.getByRole('region', { name: '计算摘要' })).toContainText('ReLU');
  await page.getByRole('button', { name: '加入图稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '导出', exact: true })).toBeEnabled();
  const vectors: string[] = [];
  for (const theme of ['dark', 'light']) {
    await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByLabel('SVG 内嵌本机字体', { exact: true }).uncheck();
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

test('operation parameters survive figure and welcome visits while creation remains scoped to assembly', async ({
  page,
}) => {
  await openWorkbench(page);
  await useModuleTool(page, '添加2D数据块');
  await page.getByRole('button', { name: '参数', exact: true }).click();
  await page.getByLabel('高度 H', { exact: true }).fill('20');
  await page.getByLabel('宽度 W', { exact: true }).fill('16');
  await page.getByLabel('通道 C', { exact: true }).fill('3');
  await page.getByRole('button', { name: '构建', exact: true }).click();
  await useModuleTool(page, '使用Conv2D');
  await page.getByLabel('输出通道', { exact: true }).fill('13');
  await page.getByLabel('卷积核 H', { exact: true }).fill('5');
  await page.getByLabel('填充方式', { exact: true }).selectOption('valid');
  const before = await page.evaluate(() => window.__studio.snapshot());
  await switchWorkspace(page, '图稿');
  await expect(page.getByRole('button', { name: '创建下一步', exact: true })).toHaveCount(0);
  await expect(page.locator('.right-panel .dock-heading')).not.toContainText('添加运算');
  await page.getByRole('tab', { name: '图稿页面', exact: true }).click();
  await expect(page.getByLabel('画板背景', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^架构图工作台/ }).click();
  await continueFromWelcome(page);
  await expect(page.getByRole('toolbar', { name: '图稿通用工具' })).toBeVisible();
  expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(before);
  await switchWorkspace(page, '组装');
  await page.getByRole('tab', { name: '对象属性', exact: true }).click();
  await expect(page.getByLabel('输出通道', { exact: true })).toHaveValue('13');
  await expect(page.getByLabel('卷积核 H', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('填充方式', { exact: true })).toHaveValue('valid');
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  await expect
    .poll(async () => {
      const report = await page.evaluate(() => window.__studio.analysis());
      return Object.values(report.nodes).some(
        (entry: any) => entry.shape?.H === 16 && entry.shape?.W === 14 && entry.shape?.C === 13,
      );
    })
    .toBe(true);
  expect((await page.evaluate(() => window.__studio.snapshot())).revision).toBe(
    before.revision + 1,
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await page.evaluate(() => window.__studio.snapshot())).entities).toEqual(before.entities);
});
