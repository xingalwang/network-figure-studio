import { expect, test } from '@playwright/test';
import { continueFromWelcome, useModuleTool, switchWorkspace } from '../fixtures/workbench.ts';

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  for (const theme of ['dark', 'light']) {
    test(`${theme} ${viewport.width}: workbench scopes, bounded local layout and export focus`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('dialog', (dialog) => dialog.accept());
      await page.setViewportSize(viewport);
      await page.goto('/');
      const welcome = page.getByRole('main', { name: '工程引导' });
      await welcome.getByLabel('界面主题', { exact: true }).selectOption(theme);
      await expect(welcome.getByRole('button', { name: '新建工程', exact: true })).toBeVisible();
      await expect(welcome.getByRole('button', { name: '打开工程', exact: true })).toBeVisible();
      await continueFromWelcome(page);
      await expect(page.locator('.calculation-summary')).toHaveClass(/collapsed/);
      const initial = await page.evaluate(() => window.__studio.snapshot());
      const library = page.getByRole('separator', { name: '调整模块栏宽度' });
      await library.focus();
      await page.keyboard.press('ArrowRight');
      await expect(library).toHaveAttribute('aria-valuenow', '236');
      const inspector = page.getByRole('separator', { name: '调整信息栏宽度' });
      await inspector.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(inspector).toHaveAttribute('aria-valuenow', '324');
      expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(initial);
      await useModuleTool(page, '添加2D数据块');
      await expect(page.locator('.calculation-summary')).not.toHaveClass(/collapsed/);
      await page.getByRole('button', { name: '收起计算摘要', exact: true }).click();
      await page.getByRole('button', { name: '参数', exact: true }).click();
      await page.getByLabel('高度 H', { exact: true }).fill('16');
      await page.getByLabel('宽度 W', { exact: true }).fill('16');
      await page.getByLabel('通道 C', { exact: true }).fill('3');
      await expect(page.getByRole('button', { name: '构建', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: '构建', exact: true }).click();
      await expect(page.locator('.calculation-summary')).toHaveClass(/collapsed/);
      await useModuleTool(page, '使用Conv2D');
      await page.getByLabel('输出通道', { exact: true }).fill('8');
      await page.getByRole('button', { name: '创建下一步', exact: true }).click();
      await expect(page.locator('.right-panel math').first()).toBeVisible();
      const built = await page.evaluate(() => window.__studio.snapshot());
      await page.getByRole('button', { name: '展开计算摘要', exact: true }).click();
      const height = page.getByRole('separator', { name: '调整底部面板高度' });
      await height.focus();
      await page.keyboard.press('ArrowUp');
      await expect(height).toHaveAttribute('aria-valuenow', '184');
      expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(built);
      await page.getByRole('button', { name: '加入图稿', exact: true }).click();
      await expect(page.getByRole('button', { name: '独立标注', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '使用Conv2D', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: '导出', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByAltText('导出预览')).toBeVisible();
      await expect(page.getByRole('button', { name: '关闭导出', exact: true })).toBeFocused();
      const geometry = await page.evaluate(() => {
        const selectors = [
          '.topbar',
          '.command-ribbon',
          '.left-panel',
          '.workspace',
          '.right-panel',
          '.calculation-summary',
          '.statusbar',
          '.export-dialog',
        ];
        return selectors.map((selector) => {
          const element = document.querySelector(selector)!;
          const r = element.getBoundingClientRect();
          return {
            selector,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
            overflow: element.scrollWidth > element.clientWidth + 1,
          };
        });
      });
      for (const r of geometry) {
        expect(r.x, r.selector).toBeGreaterThanOrEqual(0);
        expect(r.y, r.selector).toBeGreaterThanOrEqual(0);
        expect(r.right, r.selector).toBeLessThanOrEqual(viewport.width + 1);
        expect(r.bottom, r.selector).toBeLessThanOrEqual(viewport.height + 1);
        expect(r.overflow, r.selector).toBe(false);
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await switchWorkspace(page, '组装');
      await expect(page.getByRole('separator', { name: '调整模块栏宽度' })).toHaveAttribute(
        'aria-valuenow',
        '236',
      );
      expect(errors).toEqual([]);
    });
  }
}
