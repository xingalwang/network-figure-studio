import { test, expect } from '@playwright/test';
for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
])
  test(`dark workbench stays usable at ${viewport.width}, 2D preserves hidden 3D parameters`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: '兼容组合示例', exact: true }).click();
    const place = page.getByRole('button', { name: '放入画布', exact: true });
    await expect(place).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => ({
      left: document.querySelector('.left-panel')!.getBoundingClientRect().width,
      right: document.querySelector('.right-panel')!.getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > innerWidth,
      fonts:
        document.fonts.check('14px Inter') && document.fonts.check('14px "Noto Sans SC"', '编码器'),
      bg: getComputedStyle(document.querySelector('.preview-paper')!).backgroundColor,
    }));
    expect(layout).toEqual({
      left: viewport.width >= 1600 ? 236 : 220,
      right: viewport.width >= 1600 ? 322 : 308,
      overflow: false,
      fonts: true,
      bg: 'rgb(255, 255, 255)',
    });
    const bounds = await place.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(viewport.height - 28);
    await page.getByLabel('表现方式').selectOption('flat');
    await expect(page.getByLabel('厚度', { exact: true })).toHaveCount(0);
    await page.getByLabel('表现方式').selectOption('axonometric');
    await expect(page.getByLabel('厚度', { exact: true })).toHaveValue('24');
    await expect(page.getByLabel('投影角度', { exact: true })).toHaveValue('30');
    const before = await page.locator('.workspace').boundingBox();
    await page.getByRole('button', { name: '切换属性面板' }).click();
    const after = await page.locator('.workspace').boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 250);
  });
test('text editing and composition never delete the selection or undo the document', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '兼容组合示例', exact: true }).click();
  await page.getByRole('button', { name: '放入画布', exact: true }).click();
  await page.getByTestId('graph-container').click({ position: { x: 120, y: 180 } });
  await expect(page.getByLabel('手工标签')).toBeVisible();
  const before = await page.evaluate(() => window.__studio.snapshot());
  const input = page.getByLabel('手工标签');
  await input.focus();
  await input.dispatchEvent('compositionstart', { data: '编' });
  await page.keyboard.insertText('编码器');
  await input.dispatchEvent('compositionend', { data: '编码器' });
  await input.press('Backspace');
  await input.press('Control+z');
  const after = await page.evaluate(() => window.__studio.snapshot());
  expect(after).toEqual(before);
  await expect(input).toBeFocused();
});
test('a stale generation draft reports a conflict rather than overwriting a new parameter', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '兼容组合示例', exact: true }).click();
  await page.getByRole('button', { name: '放入画布', exact: true }).click();
  await page.getByTestId('graph-container').click({ position: { x: 120, y: 180 } });
  await page.getByRole('button', { name: '编辑生成参数', exact: true }).click();
  await page.getByLabel('通道数', { exact: true }).fill('128');
  await page.evaluate(async () => {
    const d = window.__studio.snapshot(),
      root = Object.values(d.entities).find((e: any) => e.parentId === null) as any;
    await window.__studio.dispatch({
      baseRevision: d.revision,
      operations: [
        {
          kind: 'generate',
          id: root.id,
          generatorId: root.generation.generatorId,
          params: { ...root.generation.source.params, channels: 96 },
        },
      ],
    });
  });
  await page.getByRole('button', { name: '应用到原组件' }).click();
  await expect(page.getByRole('alert')).toContainText('原组件的参数已经改变');
  const channels = await page.evaluate(() => {
    const d = window.__studio.snapshot(),
      root = Object.values(d.entities).find((e: any) => e.parentId === null) as any;
    return root.generation.source.params.channels;
  });
  expect(channels).toBe(96);
  await page.getByRole('button', { name: '用草稿覆盖' }).click();
  await expect(page.getByLabel('通道数', { exact: true })).toHaveValue('128');
});
test('child inspector reflects undo without reviving reverted values', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '兼容组合示例', exact: true }).click();
  await page.getByRole('button', { name: '放入画布', exact: true }).click();
  await page.getByTestId('graph-container').click({ position: { x: 120, y: 180 } });
  await expect(page.getByLabel('手工标签')).toBeVisible();
  const id = await page.evaluate(() => {
    const d = window.__studio.snapshot(),
      child = Object.values(d.entities).find(
        (e: any) => e.generation?.generatorId === 'builtin.conv',
      ) as any;
    window.__studio.select([child.id]);
    return child.id;
  });
  await page.getByLabel('通道数', { exact: true }).fill('128');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('通道数', { exact: true })).toHaveValue('64');
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByLabel('投影角度').fill('45');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  const params = await page.evaluate((id) => {
    const d = window.__studio.snapshot(),
      source = d.entities[id].generation.source;
    return d.entities[source.ownerId].generation.source.params.__slots[source.slotKey];
  }, id);
  expect(params).toEqual({ angleDeg: 45 });
});
test('adding a bend stores parent-local coordinates after the group moves', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '兼容组合示例', exact: true }).click();
  await page.getByRole('button', { name: '放入画布', exact: true }).click();
  await page.getByTestId('graph-container').click({ position: { x: 120, y: 180 } });
  await expect(page.getByLabel('手工标签')).toBeVisible();
  const setup = await page.evaluate(async () => {
    const d = window.__studio.snapshot(),
      root = Object.values(d.entities).find((e: any) => e.kind === 'group') as any,
      edge = Object.values(d.entities).find(
        (e: any) => e.kind === 'edge' && e.parentId === root.id && e.name === '连接',
      ) as any;
    await window.__studio.dispatch({
      baseRevision: d.revision,
      operations: [{ kind: 'move', id: root.id, position: { x: 200, y: 300 } }],
    });
    window.__studio.select([edge.id]);
    const a = d.entities[edge.source.entityId],
      b = d.entities[edge.target.entityId],
      p = a.ports[edge.source.portId],
      q = b.ports[edge.target.portId];
    return {
      id: edge.id,
      expected: {
        x: (a.presentation.position.x + p.x + b.presentation.position.x + q.x) / 2,
        y: (a.presentation.position.y + p.y + b.presentation.position.y + q.y) / 2 - 60,
      },
    };
  });
  await page.getByRole('button', { name: '添加折点' }).click();
  const point = await page.evaluate(
    (id) => window.__studio.snapshot().entities[id].route.points.at(-1),
    setup.id,
  );
  expect(point.x).toBeCloseTo(setup.expected.x);
  expect(point.y).toBeCloseTo(setup.expected.y);
});
test('project title follows document undo and redo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '兼容组合示例', exact: true }).click();
  const title = page.getByLabel('项目名称');
  await expect(title).toBeEnabled();
  const original = await title.inputValue();
  await title.fill('新的网络架构图');
  await title.blur();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(title).toHaveValue(original);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(title).toHaveValue('新的网络架构图');
});
test('drawing viewport survives a visit to the generator workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '兼容组合示例', exact: true }).click();
  await page.getByRole('button', { name: '放入画布', exact: true }).click();
  await page.getByTestId('graph-container').click({ position: { x: 120, y: 180 } });
  await expect(page.getByLabel('手工标签')).toBeVisible();
  const childId = await page.evaluate(
    () =>
      (
        Object.values(window.__studio.snapshot().entities).find(
          (e: any) => e.kind === 'node',
        ) as any
      ).id,
  );
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  const before = await page.evaluate((id) => window.__studio.screenPoint(id), childId);
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await page.getByRole('button', { name: '绘图', exact: true }).click();
  const after = await page.evaluate((id) => window.__studio.screenPoint(id), childId);
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
});
