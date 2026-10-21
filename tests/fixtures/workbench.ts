import { expect, type Locator, type Page } from '@playwright/test';

/** Keep application tests explicit about the welcome screen instead of bypassing it. */
export async function continueFromWelcome(page: Page) {
  // Font transfer has its own readiness budget; ordinary interactions keep their existing timeout.
  await page.waitForFunction(
    () => document.documentElement.dataset.startup === 'ready',
    undefined,
    { timeout: 30000 },
  );
  await page.getByRole('button', { name: '继续当前工程', exact: true }).click();
  await expect(page.locator('.studio.workbench')).toHaveAttribute('aria-hidden', 'false');
}
export async function openWorkbench(page: Page) {
  await page.goto('/');
  await continueFromWelcome(page);
  await page.waitForFunction(() => typeof window.__studio?.snapshot === 'function');
}
export async function showProjectStructure(page: Page) {
  await page.getByRole('tab', { name: '工程结构', exact: true }).click();
}
export async function showModuleLibrary(page: Page) {
  await page.getByRole('tab', { name: '模块库', exact: true }).click();
}
async function revealModuleTool(tool: Locator) {
  const groups = tool.locator('xpath=ancestor::details');
  for (let index = 0; index < (await groups.count()); index++) {
    const group = groups.nth(index);
    if ((await group.getAttribute('open')) === null)
      await group.locator(':scope > summary').click();
  }
  await expect(tool).toBeVisible();
}
/** Expands the same module/category disclosures used by a person finding a tool. */
export async function moduleTool(page: Page, name: string) {
  await showModuleLibrary(page);
  const tool = page.getByRole('button', { name, exact: true, includeHidden: true });
  await revealModuleTool(tool);
  return tool;
}
export async function useModuleTool(page: Page, name: string) {
  await (await moduleTool(page, name)).click();
}
export async function fileCommand(page: Page, name: string) {
  const summary = page.locator('.topbar .header-menu > summary').filter({ hasText: /^文件$/ });
  const menu = summary.locator('..');
  if ((await menu.getAttribute('open')) === null) await summary.click();
  await menu.getByRole('button', { name, exact: true }).click();
}
export async function applyModuleConnection(page: Page, name: string) {
  await showModuleLibrary(page);
  const tool = page.locator('.module-connection > button').filter({ hasText: name });
  await revealModuleTool(tool);
  await expect(tool).toBeEnabled();
  await tool.click();
}
export async function switchWorkspace(page: Page, name: '组装' | '图稿') {
  await page
    .getByRole('navigation', { name: '工作区' })
    .getByRole('button', { name, exact: true })
    .click();
}
