import { expect, test } from '@playwright/test';
import { continueFromWelcome } from '../fixtures/workbench.ts';

// Isolate fallback transfer from installed Windows/Linux fonts; the actual downloaded face is unchanged.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.FontFace = new Proxy(window.FontFace, {
      construct(target, args) {
        const [family, source, descriptors] = args;
        return Reflect.construct(target, [
          family,
          family === 'NNFigure local availability'
            ? 'local("NNFigure deliberately absent test font")'
            : source,
          descriptors,
        ]);
      },
    });
  });
});

test('delayed fallback transfer reports progress and starts the canvas only after font readiness', async ({
  page,
}) => {
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/fonts/noto-sans-sc-variable.ttf', async (route) => {
    requested = true;
    await blocked;
    await route.continue();
  });
  let delayedRelease: ReturnType<typeof setTimeout> | undefined;
  try {
    await page.goto('/');
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByRole('status', { name: '启动状态', exact: true })).toContainText(
      '正在准备字体',
    );
    await expect(page.getByTestId('graph-container')).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.__studio)).toBe('undefined');
    // Transfer deliberately exceeds the original 8s interaction budget. Only startup waits for it.
    const started = Date.now();
    delayedRelease = setTimeout(release, 9000);
    await continueFromWelcome(page);
    expect(Date.now() - started).toBeGreaterThanOrEqual(8500);
  } finally {
    clearTimeout(delayedRelease);
    release();
  }
  await expect(page.getByTestId('graph-container')).toBeVisible();
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (face) => face.family === 'Noto Sans SC' && face.status === 'loaded',
      ),
    ),
  ).toBe(true);
});

test('failed fallback transfer keeps projects open and retry preserves pending parameters and history', async ({
  page,
}) => {
  await page.route('**/fonts/noto-sans-sc-variable.ttf', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByRole('alert', { name: '字体提示', exact: true })).toContainText(
    '字体加载失败',
  );
  await continueFromWelcome(page);
  await page
    .getByTestId('open-project')
    .setInputFiles('examples/projects/residual-demo.nnfig.json');
  await expect(page.getByLabel('项目名称', { exact: true })).toHaveValue(/残差块/);
  await page.getByLabel('通道数', { exact: true }).fill('192');
  const before = await page.evaluate(() => window.__studio.snapshot());
  await page.unroute('**/fonts/noto-sans-sc-variable.ttf');
  await page.getByRole('button', { name: '重试字体', exact: true }).click();
  await expect(page.getByRole('alert', { name: '字体提示', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('通道数', { exact: true })).toHaveValue('192');
  expect(await page.evaluate(() => window.__studio.snapshot())).toEqual(before);
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (face) => face.family === 'Noto Sans SC' && face.status === 'loaded',
      ),
    ),
  ).toBe(true);
});
