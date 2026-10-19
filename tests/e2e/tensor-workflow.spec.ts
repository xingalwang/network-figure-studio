import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type {
  EdgeEntity,
  NodeEntity,
  Params,
  ProjectDocument,
} from '../../src/core/document/types.ts';

import type { AnalysisReport } from '../../src/core/computation/index.ts';

type Step = { operationId: string; resultId: string };
const snapshot = (page: Page): Promise<ProjectDocument> =>
  page.evaluate(() => window.__studio.snapshot());
const analysis = (page: Page): Promise<AnalysisReport> =>
  page.evaluate(() => (window.__studio as any).analysis());
const nodes = (doc: ProjectDocument) =>
  Object.values(doc.entities).filter((entity): entity is NodeEntity => entity.kind === 'node');
const edges = (doc: ProjectDocument) =>
  Object.values(doc.entities).filter((entity): entity is EdgeEntity => entity.kind === 'edge');
const params = (node: NodeEntity): Params =>
  node.generation?.source.kind === 'local' ? node.generation.source.params : {};

async function point(page: Page, id: string) {
  return page.evaluate((id) => window.__studio.screenPoint(id), id);
}
async function select(page: Page, id: string, shift = false) {
  const p = await point(page, id);
  expect(p).toBeTruthy();
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  if (shift) await page.keyboard.up('Shift');
}
async function edit(page: Page, id: string) {
  await page.locator(`.tree-name[data-entity-id="${id}"]`).first().click();
  const p = await point(page, id);
  await page.mouse.dblclick(p.x, p.y);
}
async function fill(page: Page, values: Record<string, string | number>) {
  for (const [name, value] of Object.entries(values))
    if (name !== '填充方式') await page.getByLabel(name, { exact: true }).fill(String(value));
}
async function addSource(page: Page) {
  const before = await snapshot(page);
  const source = page.getByRole('button', { name: '添加3D数据块', exact: true });
  const canvas = page.getByTestId('graph-container');
  await source.dragTo(canvas, { targetPosition: { x: 160, y: 180 } });
  await expect
    .poll(
      async () =>
        nodes(await snapshot(page)).filter((node) => node.semantic?.role === 'tensor-source')
          .length,
    )
    .toBe(1);
  const node = nodes(await snapshot(page)).find(
    (node) => !before.entities[node.id] && node.semantic?.role === 'tensor-source',
  )!;
  await expect.poll(async () => (await analysis(page)).nodes[node.id].state).toBe('pending');
  await edit(page, node.id);
  await fill(page, { '深度 D': 128, '高度 H': 128, '宽度 W': 128, '通道 C': 1, '批量 N': 1 });
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await expect
    .poll(async () => (await analysis(page)).nodes[node.id].shape)
    .toEqual({ N: 1, D: 128, H: 128, W: 128, C: 1 });
  return node.id;
}
async function append(
  page: Page,
  inputId: string,
  operation: 'Conv3D' | 'MaxPool3D',
  values: Record<string, string | number> = {},
): Promise<Step> {
  const before = await snapshot(page);
  await select(page, inputId);
  await page.getByRole('button', { name: '添加后续操作', exact: true }).click();
  await page
    .locator('.tensor-operation-menu')
    .getByRole('button', { name: new RegExp(`^${operation}`) })
    .click();
  await fill(page, values);
  if (values['填充方式'])
    await page.getByLabel('填充方式', { exact: true }).selectOption(String(values['填充方式']));
  const submit = page.getByRole('button', { name: '创建下一步', exact: true });
  await expect(submit).toBeEnabled();
  const zoomBefore = await page.locator('.status-actions > span').nth(1).innerText();
  const priorTensors = nodes(before)
    .filter((node) => node.semantic?.role !== 'operation')
    .slice(0, 2)
    .map((node) => node.id);
  const priorPoints = await page.evaluate(
    (ids) => ids.map((id) => window.__studio.screenPoint(id)),
    priorTensors,
  );
  await submit.click();
  await expect.poll(async () => nodes(await snapshot(page)).length).toBe(nodes(before).length + 2);
  const added = nodes(await snapshot(page)).filter((node) => !before.entities[node.id]);
  expect(await page.locator('.status-actions > span').nth(1).innerText()).toBe(zoomBefore);
  if (priorPoints.length === 2) {
    const afterPoints = await page.evaluate(
      (ids) => ids.map((id) => window.__studio.screenPoint(id)),
      priorTensors,
    );
    expect(
      Math.hypot(afterPoints[1].x - afterPoints[0].x, afterPoints[1].y - afterPoints[0].y),
    ).toBeCloseTo(
      Math.hypot(priorPoints[1].x - priorPoints[0].x, priorPoints[1].y - priorPoints[0].y),
    );
  }
  return {
    operationId: added.find((node) => node.semantic?.role === 'operation')!.id,
    resultId: added.find((node) => node.semantic?.role === 'tensor-result')!.id,
  };
}
async function concat(page: Page, inputIds: string[]): Promise<Step> {
  const before = await snapshot(page);
  for (const [index, id] of inputIds.entries())
    await page
      .locator(`.tensor-object-tree .tree-name[data-entity-id="${id}"]`)
      .click({ modifiers: index ? ['Shift'] : [] });
  await page.getByRole('button', { name: '拼接所选张量', exact: true }).click();
  await page.getByLabel('拼接维度', { exact: true }).selectOption('C');
  await page.getByRole('button', { name: '创建下一步', exact: true }).click();
  await expect.poll(async () => nodes(await snapshot(page)).length).toBe(nodes(before).length + 2);
  const added = nodes(await snapshot(page)).filter((node) => !before.entities[node.id]);
  return {
    operationId: added.find((node) => node.semantic?.role === 'operation')!.id,
    resultId: added.find((node) => node.semantic?.role === 'tensor-result')!.id,
  };
}
async function buildBranch(page: Page) {
  const sourceId = await addSource(page);
  const conv = await append(page, sourceId, 'Conv3D', { 输出通道: 16 });
  const pool = await append(page, conv.resultId, 'MaxPool3D');
  const branch = await append(page, conv.resultId, 'Conv3D', {
    '卷积核 D': 1,
    '卷积核 H': 1,
    '卷积核 W': 1,
    '步幅 D': 2,
    '步幅 H': 2,
    '步幅 W': 2,
    输出通道: 8,
    填充方式: 'valid',
  });
  const joined = await concat(page, [pool.resultId, branch.resultId]);
  return { sourceId, conv, pool, branch, joined };
}
async function download(page: Page, name: string, info: TestInfo, filename: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const file = await pending;
  const path = info.outputPath(filename);
  await file.saveAs(path);
  return path;
}

test.setTimeout(60000);

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(8000);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await expect(page.getByRole('button', { name: '添加3D数据块', exact: true })).toBeVisible();
});

test('drag a 128-cubed tensor, append Conv3D and pooling, branch and concatenate with readable calculations', async ({
  page,
}, info) => {
  const flow = await buildBranch(page);
  const doc = await snapshot(page);
  const a = (await analysis(page)).nodes;
  expect(nodes(doc).filter((node) => node.semantic?.role !== 'operation')).toHaveLength(5);
  expect(nodes(doc).filter((node) => node.semantic?.role === 'operation')).toHaveLength(4);
  expect(edges(doc)).toHaveLength(9);
  expect(edges(doc).every((edge) => edge.meaning === 'dataflow')).toBe(true);
  expect(a[flow.conv.resultId].shape).toEqual({ N: 1, D: 128, H: 128, W: 128, C: 16 });
  expect(a[flow.pool.resultId].shape).toEqual({ N: 1, D: 64, H: 64, W: 64, C: 16 });
  expect(a[flow.branch.resultId].shape).toEqual({ N: 1, D: 64, H: 64, W: 64, C: 8 });
  expect(a[flow.joined.resultId].shape).toEqual({ N: 1, D: 64, H: 64, W: 64, C: 24 });
  expect(a[flow.conv.operationId].parameterCount).toBe(448);
  expect(a[flow.branch.operationId].parameterCount).toBe(136);
  await edit(page, flow.conv.operationId);
  await expect(page.locator('.right-panel')).toContainText('448');
  await expect(page.locator('.right-panel')).toContainText('16 × (1 × 3 × 3 × 3 + 1) = 448');
  await edit(page, flow.branch.resultId);
  await page.getByRole('button', { name: '计算', exact: true }).click();
  await expect(page.locator('.right-panel')).toContainText('136');
  await expect(page.getByRole('button', { name: '编辑产生操作', exact: true })).toBeVisible();
  const detailZoom = await page.locator('.status-actions > span').nth(1).innerText();
  const beforeUndo = await snapshot(page);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await snapshot(page)).entities[flow.joined.operationId]).toBeUndefined();
  expect((await snapshot(page)).entities[flow.joined.resultId]).toBeUndefined();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await snapshot(page)).entities).toEqual(beforeUndo.entities);
  await page
    .locator(`.tensor-object-tree .tree-name[data-entity-id="${flow.joined.resultId}"]`)
    .click();
  await page.getByRole('button', { name: '计算', exact: true }).click();
  await expect(page.locator('.status-actions > span').nth(1)).toHaveText(detailZoom);
  await expect(page.locator('.save-state')).toContainText('已存于浏览器');
  await page.screenshot({ path: info.outputPath('tensor-generation-1366-detail.png') });
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.screenshot({ path: info.outputPath('tensor-generation-1366-overview.png') });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.screenshot({ path: info.outputPath('tensor-generation-1920-overview.png') });

  await page.getByLabel('项目名称', { exact: true }).fill('张量分支与拼接');
  await page.getByLabel('项目名称', { exact: true }).blur();
  await page.getByRole('button', { name: '加入图稿', exact: true }).click();
  await page.getByRole('button', { name: '绘图', exact: true }).click();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await expect(page.locator('.save-state')).toContainText('已存于浏览器');
  await page.screenshot({ path: info.outputPath('tensor-drawing-1366-clean.png') });
  const project = await download(page, '下载工程副本', info, 'tensor-branch-demo.nnfig.json');
  expect(JSON.parse(await readFile(project, 'utf8'))).toEqual(await snapshot(page));
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const svgFile = await download(page, '下载 SVG', info, 'tensor-branch-demo.svg');
  const svg = await readFile(svgFile, 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('C24');
  expect(svg).not.toMatch(/foreignObject|<script/);
  const pngFile = await download(page, '下载 PNG', info, 'tensor-branch-demo.png');
  const png = await readFile(pngFile);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1600, 900]);
});

test('upstream edits propagate, conflicts explain the actual axes, and unconfigured input never keeps a stale shape', async ({
  page,
}) => {
  const flow = await buildBranch(page);
  const ids = Object.keys((await snapshot(page)).entities);
  await edit(page, flow.conv.operationId);
  await fill(page, { 输出通道: 32 });
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await expect
    .poll(async () => (await analysis(page)).nodes[flow.joined.resultId].shape)
    .toEqual({ N: 1, D: 64, H: 64, W: 64, C: 40 });
  expect((await analysis(page)).nodes[flow.branch.operationId].parameterCount).toBe(264);
  expect(Object.keys((await snapshot(page)).entities)).toEqual(ids);

  await edit(page, flow.branch.operationId);
  await expect(page.getByLabel('输出通道', { exact: true })).toHaveValue('8');
  await expect(page.getByLabel('卷积核 D', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('步幅 D', { exact: true })).toHaveValue('2');
  await expect(page.locator('.right-panel')).toContainText('264');
  await fill(page, { '步幅 D': 1, '步幅 H': 1, '步幅 W': 1 });
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  let a = (await analysis(page)).nodes;
  expect(a[flow.branch.resultId].shape).toEqual({ N: 1, D: 128, H: 128, W: 128, C: 8 });
  expect(a[flow.joined.operationId].state).toBe('error');
  expect(a[flow.joined.resultId].shape).toBeUndefined();
  expect(a[flow.joined.operationId].diagnostics.join(' ')).toContain('D');
  await edit(page, flow.joined.resultId);
  await page.getByRole('button', { name: '计算', exact: true }).click();
  await expect(page.locator('.right-panel')).toContainText('64');
  await expect(page.locator('.right-panel')).toContainText('128');
  await expect(page.locator('.right-panel')).toContainText(/不一致|不匹配|冲突/);

  await edit(page, flow.branch.operationId);
  await fill(page, { '步幅 D': 2, '步幅 H': 2, '步幅 W': 2 });
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await expect
    .poll(async () => (await analysis(page)).nodes[flow.joined.resultId].shape?.C)
    .toBe(40);
  await edit(page, flow.sourceId);
  await expect(page.getByLabel('通道 C', { exact: true })).toHaveValue('1');
  await fill(page, { '深度 D': '' });
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  a = (await analysis(page)).nodes;
  expect(a[flow.sourceId].state).toBe('pending');
  expect(a[flow.joined.resultId].shape).toBeUndefined();
  await expect(page.locator('.right-panel')).toContainText('待配置');
  await fill(page, { '深度 D': 128 });
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await expect
    .poll(async () => (await analysis(page)).nodes[flow.joined.resultId].shape?.C)
    .toBe(40);
  expect(
    params((await snapshot(page)).entities[flow.branch.operationId] as NodeEntity).outChannels,
  ).toBe(8);
});

test('updating editable figure preserves manual layout, appearance and bends, respects removal, and saves and exports real files', async ({
  page,
}, info) => {
  const flow = await buildBranch(page);
  const generatorDoc = await snapshot(page);
  expect(nodes(generatorDoc).every((node) => node.figureState === 'unplaced')).toBe(true);
  await page.getByRole('button', { name: '加入图稿', exact: true }).click();
  await page.getByRole('button', { name: '绘图', exact: true }).click();
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  const oldSource = (await snapshot(page)).entities[flow.sourceId] as NodeEntity;
  const p = await point(page, flow.sourceId);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 44, p.y + 32, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        ((await snapshot(page)).entities[flow.sourceId] as NodeEntity).presentation.position,
    )
    .not.toEqual(oldSource.presentation.position);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await fill(page, { '显示宽度 px': 180, '显示高度 px': 126 });
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  await page.getByLabel('填充色 HEX', { exact: true }).fill('#d18c6b');
  await page.getByLabel('填充色 HEX', { exact: true }).blur();
  await page.getByLabel('手工标签', { exact: true }).fill('体数据 · 手工标注');
  await page.getByLabel('手工标签', { exact: true }).press('Enter');
  const edge = edges(await snapshot(page)).find(
    (item) => item.source.kind === 'port' && item.source.entityId === flow.sourceId,
  )!;
  await page.locator(`.tree-name[data-entity-id="${edge.id}"]`).click();
  await page.getByRole('button', { name: '添加折点', exact: true }).click();
  const laidOut = await snapshot(page);
  const before = laidOut.entities[flow.sourceId] as NodeEntity;
  const manualRoute = (laidOut.entities[edge.id] as EdgeEntity).route;
  expect(before.presentation.fillOverride).toBe('#d18c6b');
  expect(before.presentation.labelOverride).toBe('体数据 · 手工标注');
  expect(manualRoute.mode).toBe('manual');
  expect((await analysis(page)).nodes[flow.sourceId].shape).toEqual({
    N: 1,
    D: 128,
    H: 128,
    W: 128,
    C: 1,
  });
  await page.screenshot({ path: info.outputPath('tensor-drawing-1366.png') });

  await page.getByRole('button', { name: '生成', exact: true }).click();
  await edit(page, flow.conv.operationId);
  await fill(page, { 输出通道: 32 });
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  const added = await append(page, flow.pool.resultId, 'Conv3D', { 输出通道: 4 });
  await page.getByRole('button', { name: '更新图稿', exact: true }).click();
  let after = await snapshot(page);
  expect((after.entities[flow.sourceId] as NodeEntity).presentation).toEqual(before.presentation);
  expect((after.entities[flow.sourceId] as NodeEntity).size).toEqual(before.size);
  expect((after.entities[edge.id] as EdgeEntity).route).toEqual(manualRoute);
  expect(after.entities[added.resultId].figureState).toBe('visible');
  expect((await analysis(page)).nodes[flow.joined.resultId].shape?.C).toBe(40);

  await page.getByRole('button', { name: '绘图', exact: true }).click();
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await select(page, added.resultId);
  await page.keyboard.press('Delete');
  expect((await snapshot(page)).entities[added.resultId].figureState).toBe('hidden');
  expect((await analysis(page)).nodes[added.resultId].shape?.C).toBe(4);
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await page.getByRole('button', { name: '更新图稿', exact: true }).click();
  expect((await snapshot(page)).entities[added.resultId].figureState).toBe('hidden');
  await page.getByRole('button', { name: '绘图', exact: true }).click();
  const file = await download(page, '下载工程副本', info, 'tensor-branch.nnfig.json');
  const saved = JSON.parse(await readFile(file, 'utf8')) as ProjectDocument;
  after = await snapshot(page);
  expect(saved).toEqual(after);
  await page.getByTestId('open-project').setInputFiles(file);
  await expect.poll(async () => snapshot(page)).toEqual(saved);
  expect((await analysis(page)).nodes[flow.joined.resultId].shape?.C).toBe(40);
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByLabel('嵌入字体', { exact: true }).uncheck();
  const svgFile = await download(page, '下载 SVG', info, 'tensor-branch.svg');
  const svg = await readFile(svgFile, 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('体数据');
  expect(svg).toContain('#d18c6b');
  expect(svg).not.toMatch(/foreignObject|<script/);
  const exportedLabels = await page.evaluate((source) => {
    const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
    return [...xml.querySelectorAll('text')].map((node) => node.textContent);
  }, svg);
  expect(exportedLabels).toContain('C40');
  expect(exportedLabels).not.toContain('C4');
  const pngFile = await download(page, '下载 PNG', info, 'tensor-branch.png');
  const png = await readFile(pngFile);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1600, 900]);
});

test('Shift-clicking actual tensor blocks selects both and exposes merge actions', async ({
  page,
}) => {
  const sourceId = await addSource(page);
  const conv = await append(page, sourceId, 'Conv3D');
  await select(page, sourceId);
  await select(page, conv.resultId, true);
  await expect(page.getByRole('button', { name: '拼接所选张量', exact: true })).toBeVisible();
});

test('mixed figure removal hides semantic tensors without deleting calculation, removes annotation lines, and restores a hidden dataflow edge', async ({
  page,
}) => {
  const sourceId = await addSource(page);
  const conv = await append(page, sourceId, 'Conv3D');
  await page.getByRole('button', { name: '加入图稿', exact: true }).click();
  await page.getByRole('button', { name: '绘图', exact: true }).click();
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  const before = await snapshot(page);
  await page.getByRole('button', { name: '连线工具', exact: true }).click();
  const handles = await page.evaluate(
    ({ sourceId, resultId }) => [
      window.__studio.portPoint(sourceId, 'out'),
      window.__studio.portPoint(resultId, 'in'),
    ],
    { sourceId, resultId: conv.resultId },
  );
  await page.mouse.move(handles[0].x, handles[0].y);
  await page.mouse.down();
  await page.mouse.move(handles[1].x, handles[1].y, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => edges(await snapshot(page)).length).toBe(edges(before).length + 1);
  const annotation = edges(await snapshot(page)).find((edge) => !before.entities[edge.id])!;
  expect(annotation.meaning).toBe('annotation');
  await page.locator(`.tree-name[data-entity-id="${sourceId}"]`).click();
  await page
    .locator(`.tree-name[data-entity-id="${annotation.id}"]`)
    .click({ modifiers: ['Shift'] });
  await page.keyboard.press('Delete');
  const removed = await snapshot(page);
  expect(removed.entities[sourceId]).toBeDefined();
  expect(removed.entities[sourceId].figureState).toBe('hidden');
  expect(removed.entities[annotation.id]).toBeUndefined();
  expect((await analysis(page)).nodes[conv.resultId].shape?.C).toBe(16);
  expect(nodes(removed).filter((node) => node.semantic)).toHaveLength(3);

  const dataflow = edges(removed).find(
    (edge) =>
      edge.meaning === 'dataflow' &&
      edge.source.kind === 'port' &&
      edge.source.entityId === conv.operationId,
  )!;
  const route = dataflow.route;
  await page.locator(`.tree-name[data-entity-id="${dataflow.id}"]`).click();
  await page.keyboard.press('Delete');
  expect((await snapshot(page)).entities[dataflow.id].figureState).toBe('hidden');
  await page.locator(`.tree-name[data-entity-id="${dataflow.id}"]`).click();
  await expect(page.getByRole('button', { name: '恢复到图稿', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复到图稿', exact: true }).click();
  expect((await snapshot(page)).entities[dataflow.id].figureState).toBe('visible');
  expect(((await snapshot(page)).entities[dataflow.id] as EdgeEntity).route).toEqual(route);
  expect((await analysis(page)).nodes[conv.resultId].shape?.C).toBe(16);
});
