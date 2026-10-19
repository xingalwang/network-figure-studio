import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveChromiumExecutable } from './playwright-browser.ts';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jiagoutu-playwright-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const defaultExecutablePath = path.join(
    root,
    'standard',
    'chromium-9999',
    'chrome-linux64',
    'chrome',
  );
  const localExecutablePath = path.join(
    root,
    'node_modules',
    '.cache',
    'ms-playwright',
    'chromium-9999',
    'chrome-linux64',
    'chrome',
  );
  const create = (file) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '');
  };
  return { projectRoot: root, defaultExecutablePath, localExecutablePath, create, env: {} };
}

test('an explicit executable override is passed through without silent fallback', (t) => {
  const f = fixture(t);
  assert.equal(
    resolveChromiumExecutable({
      ...f,
      env: { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '/custom/chrome' },
    }),
    '/custom/chrome',
  );
});

test('a standard Playwright install keeps its default browser selection', (t) => {
  const f = fixture(t);
  f.create(f.defaultExecutablePath);
  f.create(f.localExecutablePath);
  assert.equal(resolveChromiumExecutable(f), undefined);
});

test('an explicitly configured Playwright cache is never overridden by local discovery', (t) => {
  const f = fixture(t);
  f.create(f.localExecutablePath);
  assert.equal(
    resolveChromiumExecutable({ ...f, env: { PLAYWRIGHT_BROWSERS_PATH: '/custom/cache' } }),
    undefined,
  );
});

test('the project cache is discovered using the expected browser revision', (t) => {
  const f = fixture(t);
  f.create(f.localExecutablePath);
  assert.equal(resolveChromiumExecutable(f), f.localExecutablePath);
});

test('a different revision in the project cache is not used', (t) => {
  const f = fixture(t);
  f.create(f.localExecutablePath.replace('chromium-9999', 'chromium-1111'));
  assert.equal(resolveChromiumExecutable(f), undefined);
});

test('no installed browser leaves the standard Playwright installation error intact', (t) => {
  assert.equal(resolveChromiumExecutable(fixture(t)), undefined);
});
