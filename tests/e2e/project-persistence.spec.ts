import {
  openWorkbench,
  continueFromWelcome,
  useModuleTool,
  fileCommand,
} from '../fixtures/workbench.ts';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { ProjectDocument, NodeEntity, GroupEntity } from '../../src/core/document/types.ts';

async function openEditor(page: Page) {
  await openWorkbench(page);
  await page.waitForFunction(() => typeof window.__studio?.snapshot === 'function');
}

async function snapshot(page: Page): Promise<ProjectDocument> {
  return page.evaluate(() => window.__studio.snapshot());
}

async function placeResidual(page: Page) {
  if (!(await page.getByRole('button', { name: '放入画布', exact: true }).isVisible()))
    await useModuleTool(page, '使用Residual Block');
  await expect(page.getByRole('button', { name: '放入画布', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '放入画布', exact: true }).click();
  await page.getByTestId('graph-container').click({ position: { x: 140, y: 180 } });
  await expect(page.getByLabel('手工标签', { exact: true })).toBeVisible();
  await expect
    .poll(async () => Object.keys((await snapshot(page)).entities).length)
    .toBeGreaterThan(0);
}

async function labelSelection(page: Page, label: string) {
  await page.getByLabel('手工标签', { exact: true }).fill(label);
  await page.getByLabel('手工标签', { exact: true }).press('Enter');
  await expect
    .poll(async () =>
      Object.values((await snapshot(page)).entities).some(
        (entity) => entity.kind !== 'edge' && entity.presentation.labelOverride === label,
      ),
    )
    .toBe(true);
}

async function waitForAutosave(page: Page) {
  const current = await snapshot(page);
  await expect
    .poll(() =>
      page.evaluate(async (projectId) => {
        const modulePath = '/src/persistence/indexeddb.ts';
        const { createIndexedDBRepository } = await import(modulePath);
        const repository = createIndexedDBRepository();
        try {
          return await repository.load(projectId);
        } finally {
          repository.close();
        }
      }, current.id),
    )
    .toEqual(current);
  await expect(page.locator('.save-state')).toContainText('已存于浏览器');
}

function rootLabel(doc: ProjectDocument) {
  return (
    Object.values(doc.entities).find(
      (entity) => entity.parentId === null && entity.kind !== 'edge',
    ) as NodeEntity | GroupEntity
  ).presentation.labelOverride;
}

test('a generated diagram downloads as an editable project and survives new-project/open-file roundtrip', async ({
  page,
}) => {
  await openEditor(page);
  await useModuleTool(page, '使用Residual Block');
  await page.getByLabel('通道数', { exact: true }).fill('96');
  await page.getByLabel('厚度', { exact: true }).fill('40');
  await page.getByLabel('投影角度', { exact: true }).fill('45');
  await placeResidual(page);
  await labelSelection(page, '编码器 · 保留手工标注');
  await page.getByLabel('位置 X', { exact: true }).fill('180');
  await page.getByLabel('位置 X', { exact: true }).press('Tab');
  await expect
    .poll(async () => {
      const root = Object.values((await snapshot(page)).entities).find(
        (entity) => entity.parentId === null && entity.kind !== 'edge',
      ) as NodeEntity | GroupEntity;
      return root.presentation.position.x;
    })
    .toBe(180);

  const generated = await snapshot(page);
  const connection = Object.values(generated.entities).find((entity) => entity.kind === 'edge');
  expect(connection).toBeTruthy();
  await page.evaluate((id) => window.__studio.select([id]), connection!.id);
  await page.getByRole('button', { name: '添加折点', exact: true }).click();
  const before = await snapshot(page);
  const root = Object.values(before.entities).find(
    (entity) => entity.parentId === null && entity.kind !== 'edge',
  )!;
  expect(root.generation?.source.kind).toBe('local');
  if (root.generation?.source.kind === 'local') {
    expect(root.generation.source.params).toMatchObject({ channels: 96, depth: 40, angleDeg: 45 });
  }
  const editedConnection = before.entities[connection!.id];
  expect(editedConnection.kind === 'edge' && editedConnection.route.mode).toBe('manual');

  const downloading = page.waitForEvent('download');
  await fileCommand(page, '下载工程副本');
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.nnfig\.json$/);
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  expect(JSON.parse(await readFile(downloadedPath!, 'utf8'))).toEqual(before);
  await expect(page.locator('.file-state')).toContainText('已发起下载');

  await fileCommand(page, '新建工程');
  await expect.poll(async () => (await snapshot(page)).id).not.toBe(before.id);
  expect(Object.keys((await snapshot(page)).entities)).toHaveLength(0);
  await page.getByTestId('open-project').setInputFiles(downloadedPath!);
  await expect.poll(async () => snapshot(page)).toEqual(before);
  await expect(page.getByLabel('手工标签', { exact: true })).toHaveValue('编码器 · 保留手工标注');
  await expect(page.getByLabel('手工标签', { exact: true })).toBeEnabled();
});

test('invalid and unsupported JSON imports leave the current editable project intact', async ({
  page,
}) => {
  await openEditor(page);
  await placeResidual(page);
  await labelSelection(page, '不能被坏文件清空');
  const before = await snapshot(page);
  await page.getByTestId('open-project').setInputFiles({
    name: 'broken.nnfig.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });
  await expect(page.getByRole('alert')).toContainText('无法读取此工程文件');
  expect(await snapshot(page)).toEqual(before);
  await page.getByTestId('open-project').setInputFiles({
    name: 'future.nnfig.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...before, schemaVersion: 99 })),
  });
  await expect(page.getByRole('alert')).toContainText('工程格式');
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByLabel('手工标签', { exact: true })).toHaveValue('不能被坏文件清空');
  await expect(page.getByLabel('手工标签', { exact: true })).toBeEnabled();
});

test('a second tab restores latest read-only and reloads newer persisted edits on an explicit handoff', async ({
  page,
  context,
}) => {
  await openEditor(page);
  await placeResidual(page);
  await labelSelection(page, '接管前的旧版本');
  await waitForAutosave(page);
  const original = await snapshot(page);
  const follower = await context.newPage();
  await openEditor(follower);
  await expect.poll(async () => snapshot(follower)).toEqual(original);
  await expect(follower.locator('.save-state')).toContainText('只读');
  await expect(follower.getByLabel('项目名称', { exact: true })).not.toBeEditable();
  await expect(follower.getByLabel('手工标签', { exact: true })).toBeDisabled();
  await expect(follower.getByRole('button', { name: '构建', exact: true })).toBeDisabled();
  const rejected = await follower.evaluate(() => {
    const doc = window.__studio.snapshot();
    return window.__studio.dispatch({
      baseRevision: doc.revision,
      operations: [{ kind: 'metadata', title: 'read-only must reject' }],
    });
  });
  expect(rejected.ok).toBe(false);
  expect(rejected.error.code).toBe('READONLY');
  expect(await snapshot(follower)).toEqual(original);

  await labelSelection(page, '接管时必须重读的新版本');
  await waitForAutosave(page);
  const latest = await snapshot(page);
  expect(rootLabel(await snapshot(follower))).toBe('接管前的旧版本');
  await fileCommand(page, '新建工程');
  await expect.poll(async () => (await snapshot(page)).id).not.toBe(original.id);
  await follower.getByRole('button', { name: '接管编辑', exact: true }).click();
  await expect.poll(async () => snapshot(follower)).toEqual(latest);
  await expect(follower.getByLabel('手工标签', { exact: true })).toBeEnabled();
  await labelSelection(follower, '接管后继续编辑');
  await waitForAutosave(follower);
  await follower.close();
});

test('closing the owning tab exposes a takeover action and restores its latest saved revision', async ({
  page,
  context,
}) => {
  await openEditor(page);
  await placeResidual(page);
  await labelSelection(page, '第二页加载时的版本');
  await waitForAutosave(page);
  const follower = await context.newPage();
  await openEditor(follower);
  await expect(follower.locator('.save-state')).toContainText('只读');
  await expect(follower.getByLabel('手工标签', { exact: true })).toBeDisabled();
  await labelSelection(page, '原页关闭前已保存的新版本');
  await waitForAutosave(page);
  const latest = await snapshot(page);
  await page.close();
  await follower.bringToFront();
  await expect(follower.getByRole('button', { name: '接管编辑', exact: true })).toBeVisible();
  await follower.getByRole('button', { name: '接管编辑', exact: true }).click();
  await expect.poll(async () => snapshot(follower)).toEqual(latest);
  await expect(follower.getByLabel('手工标签', { exact: true })).toBeEnabled();
  await labelSelection(follower, '关闭原页后继续编辑');
  await waitForAutosave(follower);
  await follower.close();
});

async function renameProject(page: Page, title: string) {
  await page.getByLabel('项目名称', { exact: true }).fill(title);
  await page.getByLabel('项目名称', { exact: true }).press('Tab');
  await expect.poll(async () => (await snapshot(page)).title).toBe(title);
}

async function readStored(page: Page, projectId: string) {
  return page.evaluate(async (id) => {
    const modulePath = '/src/persistence/indexeddb.ts';
    const { createIndexedDBRepository } = await import(modulePath);
    const repository = createIndexedDBRepository();
    try {
      return await repository.load(id);
    } finally {
      repository.close();
    }
  }, projectId);
}

async function delayLockRequest(page: Page, requestNumber: number) {
  await page.addInitScript((number) => {
    const request = navigator.locks.request.bind(navigator.locks);
    let calls = 0;
    (navigator.locks as any).request = (...args: any[]) => {
      calls++;
      if (calls !== number) return (request as any)(...args);
      (window as any).__lockWaiting = true;
      return new Promise((resolve) => {
        (window as any).__releaseLockRequest = () => resolve((request as any)(...args));
      });
    };
  }, requestNumber);
}

test('lifecycle restore rereads under its acquired lock while explicit file opening keeps file authority', async ({
  page,
  context,
}) => {
  await openEditor(page);
  await renameProject(page, '恢复候选 r1');
  await waitForAutosave(page);
  const old = await snapshot(page);
  const follower = await context.newPage();
  await delayLockRequest(follower, 1);
  await follower.goto('/');
  await follower.waitForFunction(() => (window as any).__lockWaiting === true);
  await renameProject(page, '持锁页已保存 r2');
  await waitForAutosave(page);
  const latest = await snapshot(page);
  await fileCommand(page, '新建工程');
  await expect.poll(async () => (await snapshot(page)).id).not.toBe(old.id);
  await follower.evaluate(() => (window as any).__releaseLockRequest());
  await follower.waitForFunction(() => typeof window.__studio?.snapshot === 'function');
  await continueFromWelcome(follower);
  await expect(follower.getByLabel('项目名称', { exact: true })).toBeEditable();
  await waitForAutosave(follower);
  expect(await snapshot(follower)).toEqual(latest);
  expect(await readStored(follower, old.id)).toEqual(latest);

  await follower.getByTestId('open-project').setInputFiles({
    name: 'chosen-old.nnfig.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(old)),
  });
  await expect.poll(async () => snapshot(follower)).toEqual(old);
  await waitForAutosave(follower);
  expect(await readStored(follower, old.id)).toEqual(old);
  await follower.close();
});

test('lifecycle takeover rereads edits committed while its lock request was delayed', async ({
  page,
  context,
}) => {
  await openEditor(page);
  await renameProject(page, '只读页已看到 r1');
  await waitForAutosave(page);
  const old = await snapshot(page);
  const follower = await context.newPage();
  await delayLockRequest(follower, 2);
  await openEditor(follower);
  await expect(follower.locator('.save-state')).toContainText('只读');
  await follower.getByRole('button', { name: '接管编辑', exact: true }).click();
  await follower.waitForFunction(() => (window as any).__lockWaiting === true);
  await renameProject(page, '重试期间原页又保存 r2');
  await waitForAutosave(page);
  const latest = await snapshot(page);
  await fileCommand(page, '新建工程');
  await expect.poll(async () => (await snapshot(page)).id).not.toBe(old.id);
  await follower.evaluate(() => (window as any).__releaseLockRequest());
  await expect(follower.getByLabel('项目名称', { exact: true })).toBeEditable();
  await waitForAutosave(follower);
  expect(await snapshot(follower)).toEqual(latest);
  expect(await readStored(follower, old.id)).toEqual(latest);
  await follower.close();
});

test('lifecycle independent-file mode confirms dirty new/open and a download does not count as a confirmed disk write', async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, 'locks', { value: undefined }),
  );
  await openEditor(page);
  await expect(page.locator('.save-state')).toContainText('独立文件模式');
  await renameProject(page, '只能在内存中的修改');
  const before = await snapshot(page);
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await fileCommand(page, '新建工程');
  expect(dialogs).toHaveLength(1);
  expect(await snapshot(page)).toEqual(before);
  const downloading = page.waitForEvent('download');
  await fileCommand(page, '下载工程副本');
  await downloading;
  await fileCommand(page, '新建工程');
  expect(dialogs).toHaveLength(2);
  expect(await snapshot(page)).toEqual(before);
  await page.getByTestId('open-project').setInputFiles({
    name: 'other.nnfig.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...before, id: 'another-project', title: '另一个工程' })),
  });
  await expect.poll(() => dialogs.length).toBe(3);
  expect(await snapshot(page)).toEqual(before);
  expect(await readStored(page, before.id)).toBeNull();
});

test('lifecycle protects changed generation drafts but not untouched defaults or successfully applied work', async ({
  page,
}) => {
  await openEditor(page);
  await useModuleTool(page, '使用Residual Block');
  await expect(page.getByRole('button', { name: '放入画布', exact: true })).toBeEnabled();
  await waitForAutosave(page);
  const preventsUnload = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(await preventsUnload()).toBe(false);
  await page.getByLabel('通道数', { exact: true }).fill('77');
  expect(await preventsUnload()).toBe(true);
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  const originalId = (await snapshot(page)).id;
  await fileCommand(page, '新建工程');
  expect(dialogs).toHaveLength(1);
  expect((await snapshot(page)).id).toBe(originalId);
  await expect(page.getByLabel('通道数', { exact: true })).toHaveValue('77');
  await page.getByLabel('通道数', { exact: true }).fill('64');
  expect(await preventsUnload()).toBe(false);
  await placeResidual(page);
  await waitForAutosave(page);
  await page.getByRole('button', { name: '编辑生成参数', exact: true }).click();
  expect(await preventsUnload()).toBe(false);
  await page.getByLabel('通道数', { exact: true }).fill('123');
  expect(await preventsUnload()).toBe(true);
  await fileCommand(page, '新建工程');
  expect(dialogs).toHaveLength(2);
  await expect(page.getByLabel('通道数', { exact: true })).toHaveValue('123');
  await page.getByRole('button', { name: '构建', exact: true }).click();
  await waitForAutosave(page);
  expect(await preventsUnload()).toBe(false);
});

test('lifecycle distinguishes a denied lock from another writer and retries without unsafe autosave', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const request = navigator.locks.request.bind(navigator.locks);
    (window as any).__denyLock = true;
    (navigator.locks as any).request = (...args: any[]) => {
      if ((window as any).__denyLock)
        return Promise.reject(new DOMException('Storage access denied', 'SecurityError'));
      return (request as any)(...args);
    };
  });
  await openEditor(page);
  await expect(page.getByRole('alert')).toContainText('Storage access denied');
  await expect(page.locator('.save-state')).not.toContainText('另一标签页');
  await expect(page.getByLabel('项目名称', { exact: true })).not.toBeEditable();
  const doc = await snapshot(page);
  expect(await readStored(page, doc.id)).toBeNull();
  await expect(page.getByRole('button', { name: '重试项目锁', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).__denyLock = false;
  });
  await page.getByRole('button', { name: '重试项目锁', exact: true }).click();
  await expect(page.getByLabel('项目名称', { exact: true })).toBeEditable();
  await waitForAutosave(page);
  expect(await snapshot(page)).toEqual(doc);
});
