import { expect, test } from '@playwright/test';
import type { ProjectDocument } from '../../src/core/document/types.ts';

for (const kind of ['primitive', 'tensor'] as const) {
  test(`${kind} parameter drafts survive selection, reject conflicts, and clear only after apply`, async ({
    page,
  }) => {
    await page.goto('/');
    if (kind === 'primitive')
      await page.getByRole('button', { name: '自由基元', exact: true }).click();
    const add = page.getByRole('button', {
      name: kind === 'primitive' ? '添加卷积层' : '2D 数据',
      exact: true,
    });
    const field = kind === 'primitive' ? '通道数' : '高度 H';
    const key = kind === 'primitive' ? 'channels' : 'H';
    await add.click();
    const id = await page.evaluate(() => {
      const document: ProjectDocument = window.__studio.snapshot();
      return Object.values(document.entities)[0].id;
    });
    if (kind === 'tensor') await page.getByRole('button', { name: '参数', exact: true }).click();
    await page.getByLabel(field, { exact: true }).fill('96');
    await add.click();
    if (kind === 'primitive') await page.getByRole('button', { name: '结构', exact: true }).click();
    await page.locator(`.tree-name[data-entity-id="${id}"]`).first().click();
    if (kind === 'tensor') await page.getByRole('button', { name: '参数', exact: true }).click();
    await expect(page.getByLabel(field, { exact: true })).toHaveValue('96');
    const changed = await page.evaluate(
      async ({ id, key }) => {
        const doc = window.__studio.snapshot();
        const generation = doc.entities[id].generation!;
        if (generation.source.kind !== 'local')
          throw new Error('Expected an independent primitive');
        const result = await window.__studio.dispatch({
          baseRevision: doc.revision,
          operations: [
            {
              kind: 'generate',
              id,
              generatorId: generation.generatorId,
              params: { ...generation.source.params, [key]: 128 },
            },
          ],
        });
        if (!result.ok) throw new Error(result.error.message);
        return window.__studio.snapshot();
      },
      { id, key },
    );
    await expect(page.locator('.right-panel .warning')).toContainText('原参数已改变');
    await expect(page.getByLabel(field, { exact: true })).toHaveValue('96');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: '应用参数', exact: true }).click();
    expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(changed);
    await expect(page.getByLabel(field, { exact: true })).toHaveValue('96');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '应用参数', exact: true }).click();
    await expect(page.locator('.right-panel .warning')).toHaveCount(0);
    const value = await page.evaluate(
      ({ id, key }) => {
        const source = window.__studio.snapshot().entities[id].generation!.source;
        return source.kind === 'local' ? source.params[key] : undefined;
      },
      { id, key },
    );
    expect(value).toBe(96);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.getByLabel(field, { exact: true })).toHaveValue('128');
    await expect(page.locator('.right-panel .warning')).toHaveCount(0);
  });
}
