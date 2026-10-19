import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { EdgeEntity, NodeEntity, ProjectDocument } from '../../src/core/document/types.ts';

type AddedNode = { id: string; name: string };
const snapshot = (page: Page): Promise<ProjectDocument> =>
  page.evaluate(() => window.__studio.snapshot());
const edges = (doc: ProjectDocument) =>
  Object.values(doc.entities).filter((entity): entity is EdgeEntity => entity.kind === 'edge');

async function add(page: Page, name: string): Promise<AddedNode> {
  await page.getByRole('button', { name: '基元', exact: true }).click();
  const before = await snapshot(page);
  await page.getByRole('button', { name: `添加${name}`, exact: true }).click();
  await expect
    .poll(async () => Object.keys((await snapshot(page)).entities).length)
    .toBe(Object.keys(before.entities).length + 1);
  const node = Object.values((await snapshot(page)).entities).find(
    (entity) => !Object.hasOwn(before.entities, entity.id),
  )!;
  expect(node.kind).toBe('node');
  expect(node.parentId).toBeNull();
  expect(node.generation?.source.kind).toBe('local');
  return { id: node.id, name: node.name };
}

async function selectNodes(page: Page, nodes: AddedNode[]) {
  await page.getByRole('button', { name: '结构', exact: true }).click();
  for (const [index, node] of nodes.entries()) {
    await page
      .locator('.tree-name')
      .getByText(node.name, { exact: true })
      .click({
        modifiers: index ? ['Shift'] : [],
      });
  }
}

async function connect(page: Page, id: string) {
  await page.getByLabel('连接模式', { exact: true }).selectOption(id);
  const apply = page.getByRole('button', { name: '应用连接方式', exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
}

async function fileDownload(page: Page, name: string, testInfo: TestInfo, filename: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const download = await pending;
  const path = testInfo.outputPath(filename);
  await download.saveAs(path);
  return path;
}

async function setBlur(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).blur();
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await page.getByRole('button', { name: '自由基元', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加卷积层', exact: true })).toBeVisible();
  await expect.poll(async () => Object.keys((await snapshot(page)).entities).length).toBe(0);
});

test('build freely connected primitives, edit parameters and color, then save, reopen and export', async ({
  page,
}, testInfo) => {
  const input = await add(page, '输入特征');
  const conv = await add(page, '卷积层');
  const pool = await add(page, '池化层');
  const concat = await add(page, '拼接');
  const linear = await add(page, '全连接层');
  const nodes = [input, conv, pool, concat, linear];
  await selectNodes(page, nodes);
  await connect(page, 'builtin.chain');
  await expect.poll(async () => edges(await snapshot(page)).length).toBe(4);
  let doc = await snapshot(page);
  expect(
    edges(doc).map((edge) => [
      edge.source.kind === 'port' && edge.source.entityId,
      edge.target.kind === 'port' && edge.target.entityId,
    ]),
  ).toEqual([
    [input.id, conv.id],
    [conv.id, pool.id],
    [pool.id, concat.id],
    [concat.id, linear.id],
  ]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => edges(await snapshot(page)).length).toBe(0);
  await selectNodes(page, [input, conv, pool]);
  await connect(page, 'builtin.branch');
  await selectNodes(page, [conv, pool, concat]);
  await connect(page, 'builtin.merge');
  await selectNodes(page, [concat, linear]);
  await connect(page, 'builtin.chain');
  await expect.poll(async () => edges(await snapshot(page)).length).toBe(5);
  doc = await snapshot(page);
  expect(
    edges(doc)
      .filter((edge) => edge.target.kind === 'port' && edge.target.entityId === concat.id)
      .map((edge) => edge.target.kind === 'port' && edge.target.portId),
  ).toEqual(['in', 'in2']);
  expect(Object.values(doc.entities).every((entity) => entity.parentId === null)).toBe(true);
  await page.locator('.tree-name').getByText('一对多分支', { exact: true }).first().click();
  await setBlur(page, '连线颜色 HEX', '#3478ab');
  await setBlur(page, '线宽', '2.5');
  await setBlur(page, '连线不透明度', '0.7');
  expect(edges(await snapshot(page))[0].style).toMatchObject({
    color: '#3478ab',
    width: 2.5,
    opacity: 0.7,
  });

  await page.getByRole('button', { name: '图稿', exact: true }).click();
  await page.getByRole('button', { name: '暖灰', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).theme.nodeColor).toBe('#ded3c4');
  await page.getByRole('button', { name: '组件', exact: true }).click();
  await selectNodes(page, [conv]);
  await page.getByLabel('通道数', { exact: true }).fill('128');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await setBlur(page, '填充色 HEX', '#d18c6b');
  doc = await snapshot(page);
  const editedConv = doc.entities[conv.id] as NodeEntity;
  expect(editedConv.generation?.source).toMatchObject({ kind: 'local', params: { channels: 128 } });
  expect(editedConv.presentation.fillOverride).toBe('#d18c6b');
  const connectionIds = edges(doc).map((edge) => edge.id);
  expect(connectionIds).toHaveLength(5);
  await page.getByRole('button', { name: '绘图', exact: true }).click();
  await expect
    .poll(async () => snapshot(page).then((value) => value.entities))
    .toEqual(doc.entities);
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  const point = await page.evaluate((id) => window.__studio.screenPoint(id), conv.id);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 35, point.y + 28, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).entities[conv.id]).not.toEqual(editedConv);
  const moved = await snapshot(page);
  await page.screenshot({ path: testInfo.outputPath('composed-drawing.png') });
  expect((moved.entities[conv.id] as NodeEntity).presentation.position).not.toEqual(
    editedConv.presentation.position,
  );
  expect(edges(moved).map((edge) => edge.id)).toEqual(connectionIds);
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).entities).toEqual(moved.entities);
  await page.getByRole('button', { name: '绘图', exact: true }).click();
  const savedPath = await fileDownload(
    page,
    '下载工程副本',
    testInfo,
    'composed-network.nnfig.json',
  );
  const saved = JSON.parse(await readFile(savedPath, 'utf8')) as ProjectDocument;
  expect(saved).toEqual(moved);
  await page.getByTestId('open-project').setInputFiles(savedPath);
  await expect.poll(async () => snapshot(page)).toEqual(saved);
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByLabel('嵌入字体', { exact: true }).uncheck();
  const svgPath = await fileDownload(page, '下载 SVG', testInfo, 'composed-network.svg');
  const svg = await readFile(svgPath, 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('#d18c6b');
  expect(svg).not.toMatch(/foreignObject|<script/);
  const pngPath = await fileDownload(page, '下载 PNG', testInfo, 'composed-network.png');
  const png = await readFile(pngPath);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1600, 900]);
});

test('attention and parallel extensions remain ordinary editable primitives and connections', async ({
  page,
}) => {
  const input = await add(page, '输入特征');
  const conv = await add(page, '卷积层');
  const pool = await add(page, '池化层');
  const concat = await add(page, '拼接');
  const attention = await add(page, '注意力门');
  const attentionBefore = (await snapshot(page)).entities[attention.id] as NodeEntity;
  expect(Object.keys(attentionBefore.ports)).toEqual(['in', 'gate', 'out']);
  await page.getByLabel('注意力头数', { exact: true }).fill('8');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  expect((await snapshot(page)).entities[attention.id].generation?.source).toMatchObject({
    kind: 'local',
    params: { heads: 8 },
  });
  await selectNodes(page, [input, conv, pool, concat]);
  const before = await snapshot(page);
  await connect(page, 'example.parallel-branches');
  await expect.poll(async () => edges(await snapshot(page)).length).toBe(4);
  const connected = await snapshot(page);
  expect(connected.revision).toBe(before.revision + 1);
  expect(edges(connected).every((edge) => edge.parentId === null && !edge.generation)).toBe(true);
  expect(
    edges(connected).map((edge) => [
      edge.source.kind === 'port' && edge.source.entityId,
      edge.target.kind === 'port' && edge.target.entityId,
    ]),
  ).toEqual([
    [input.id, conv.id],
    [input.id, pool.id],
    [conv.id, concat.id],
    [pool.id, concat.id],
  ]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await snapshot(page)).entities).toEqual(before.entities);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await snapshot(page)).entities).toEqual(connected.entities);
  await page.locator('.tree-name').getByText('双路并行', { exact: true }).first().click();
  await page.keyboard.press('Delete');
  await expect.poll(async () => edges(await snapshot(page)).length).toBe(3);
  expect(
    Object.values((await snapshot(page)).entities).filter((entity) => entity.kind === 'node'),
  ).toHaveLength(5);
  await selectNodes(page, [attention]);
  await page.keyboard.press('Delete');
  await expect
    .poll(
      async () =>
        Object.values((await snapshot(page)).entities).filter((entity) => entity.kind === 'node')
          .length,
    )
    .toBe(4);
  expect((await snapshot(page)).entities[attention.id]).toBeUndefined();
});

test('custom background, opacity and borderless styling are reflected in actual SVG and PNG downloads', async ({
  page,
}, testInfo) => {
  const conv = await add(page, '卷积层');
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByLabel('表现方式', { exact: true }).selectOption('flat');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await setBlur(page, '填充色 HEX', '#ff0000');
  await setBlur(page, '节点不透明度', '0.5');
  await setBlur(page, '边框粗细', '0');
  const node = (await snapshot(page)).entities[conv.id] as NodeEntity;
  expect(node.presentation).toMatchObject({
    fillOverride: '#ff0000',
    opacityOverride: 0.5,
    strokeWidthOverride: 0,
  });
  await page.getByRole('button', { name: '图稿', exact: true }).click();
  await page.getByLabel('画板背景', { exact: true }).selectOption('custom');
  await setBlur(page, '画板背景色 HEX', '#204060');
  expect((await snapshot(page)).page.background).toBe('#204060');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '图稿背景', exact: true })).toHaveValue('custom');
  await expect(page.getByLabel('背景颜色', { exact: true })).toHaveValue('#204060');
  await page.getByLabel('宽度（px）', { exact: true }).fill('640');
  await page.getByLabel('高度（px）', { exact: true }).fill('360');
  await page.getByLabel('嵌入字体', { exact: true }).uncheck();
  const svgPath = await fileDownload(page, '下载 SVG', testInfo, 'custom-appearance.svg');
  const svg = await readFile(svgPath, 'utf8');
  const attributes = await page.evaluate((text) => {
    const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
    const shape = [...xml.querySelectorAll('path,rect,ellipse,polygon')].find(
      (element) => element.getAttribute('fill') === '#ff0000',
    );
    if (!shape) return null;
    const inherited = (name: string) => {
      let current: Element | null = shape;
      while (current) {
        const value = current.getAttribute(name);
        if (value !== null) return value;
        current = current.parentElement;
      }
      return null;
    };
    let opacity = 1,
      current: Element | null = shape;
    while (current) {
      opacity *= Number(current.getAttribute('opacity') ?? 1);
      current = current.parentElement;
    }
    return {
      background: !![...xml.querySelectorAll('rect')].find(
        (element) => element.getAttribute('fill') === '#204060',
      ),
      opacity: opacity * Number(inherited('fill-opacity') ?? 1),
      borderless: inherited('stroke') === 'none' || Number(inherited('stroke-width') ?? 1) === 0,
    };
  }, svg);
  expect(attributes).toEqual({ background: true, opacity: 0.5, borderless: true });
  const pngPath = await fileDownload(page, '下载 PNG', testInfo, 'custom-appearance.png');
  const png = await readFile(pngPath);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640, 360]);
  const pixels = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      );
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let translucentRed = 0;
      for (let i = 0; i < data.length; i += 4)
        if (
          Math.abs(data[i] - 144) <= 1 &&
          Math.abs(data[i + 1] - 32) <= 1 &&
          Math.abs(data[i + 2] - 48) <= 1 &&
          data[i + 3] === 255
        )
          translucentRed++;
      return {
        corners: [
          [0, 0],
          [639, 0],
          [0, 359],
          [639, 359],
        ].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]),
        translucentRed,
      };
    },
    [...png],
  );
  expect(pixels.corners).toEqual(Array.from({ length: 4 }, () => [32, 64, 96, 255]));
  expect(pixels.translucentRed).toBeGreaterThan(1000);
});

test('independent primitive drafts and applied parameters never bleed across selection', async ({
  page,
}) => {
  const conv = await add(page, '卷积层');
  await page.getByLabel('通道数', { exact: true }).fill('128');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  const pool = await add(page, '池化层');
  await expect(page.getByLabel('通道数', { exact: true })).toHaveValue('64');
  await page.getByLabel('通道数', { exact: true }).fill('96');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await selectNodes(page, [conv]);
  await expect(page.getByLabel('通道数', { exact: true })).toHaveValue('128');
  await page.getByLabel('通道数', { exact: true }).fill('77');
  await selectNodes(page, [pool]);
  await expect(page.getByLabel('通道数', { exact: true })).toHaveValue('96');
  await page.getByLabel('通道数', { exact: true }).fill('48');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await selectNodes(page, [conv]);
  await expect(page.getByLabel('通道数', { exact: true })).toHaveValue('77');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  const doc = await snapshot(page);
  expect(doc.entities[conv.id].generation?.source).toMatchObject({
    kind: 'local',
    params: { channels: 77 },
  });
  expect(doc.entities[pool.id].generation?.source).toMatchObject({
    kind: 'local',
    params: { channels: 48 },
  });
});

test('structure parameter re-projection preserves the effective zoom and screen positions', async ({
  page,
}) => {
  const conv = await add(page, '卷积层');
  const pool = await add(page, '池化层');
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await selectNodes(page, [conv]);
  const before = await page.evaluate(
    (ids) => ids.map((id) => window.__studio.screenPoint(id)),
    [conv.id, pool.id],
  );
  const zoomBefore = await page.locator('.status-actions > span').nth(1).innerText();
  await page.getByLabel('通道数', { exact: true }).fill('128');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).entities[conv.id].generation?.source)
    .toMatchObject({ kind: 'local', params: { channels: 128 } });
  const after = await page.evaluate(
    (ids) => ids.map((id) => window.__studio.screenPoint(id)),
    [conv.id, pool.id],
  );
  for (let i = 0; i < before.length; i++) {
    expect(after[i].x).toBeCloseTo(before[i].x);
    expect(after[i].y).toBeCloseTo(before[i].y);
  }
  expect(await page.locator('.status-actions > span').nth(1).innerText()).toBe(zoomBefore);
});
