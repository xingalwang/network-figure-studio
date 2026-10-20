import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareRelease, releaseFiles, releaseDirectories } from './prepare-release.mjs';

async function fixture(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'jiagoutu-release-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'development');
  for (const file of releaseFiles) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    const value =
      file === 'package.json'
        ? JSON.stringify({ name: 'network-figure-studio', version: '0.1.1' })
        : file === 'package-lock.json'
          ? JSON.stringify({ version: '0.1.1', packages: { '': { version: '0.1.1' } } })
          : file;
    await writeFile(path.join(root, file), value);
  }
  for (const directory of releaseDirectories) {
    await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, directory, 'sample.ts'), 'export {};');
  }
  return { root, out: path.join(temporary, 'V0.1.1') };
}

test('exports only the explicit release inventory, excluding local materials and generated data', async (t) => {
  const { root, out } = await fixture(t);
  for (const file of [
    'AGENTS.md',
    '打开工作台.lnk',
    'docs/local/notes.md',
    '.env',
    'dist/index.html',
    'node_modules/pkg/index.js',
    'scripts/test-results/shot.png',
    'src/.env.local',
  ]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'not a release file');
  }
  const result = await prepareRelease(root, out);
  assert.equal(result.version, '0.1.1');
  assert.ok(result.files.includes('src/sample.ts'));
  assert.ok(result.files.includes('scripts/sample.ts'));
  assert.ok(result.files.includes('docs/architecture.md'));
  assert.ok(!result.files.includes('打开工作台.lnk'));
  for (const name of ['CONTRIBUTING.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md']) {
    assert.ok(result.files.includes(`docs/${name}`));
    assert.ok(!result.files.includes(name));
  }
  assert.ok(
    !result.files.some((file) => /AGENTS|local|\.env|node_modules|dist\/|test-results/.test(file)),
  );
  assert.equal(await readFile(path.join(out, 'src/sample.ts'), 'utf8'), 'export {};');
  assert.deepEqual(
    (await readdir(out)).sort(),
    [...new Set(result.files.map((file) => file.split('/')[0]))].sort(),
  );
});

test('refuses to overwrite an existing version or write into the development tree', async (t) => {
  const { root, out } = await fixture(t);
  await mkdir(out);
  await writeFile(path.join(out, 'existing.txt'), 'keep');
  await assert.rejects(() => prepareRelease(root, out), /非空|non-empty/);
  assert.equal(await readFile(path.join(out, 'existing.txt'), 'utf8'), 'keep');
  await assert.rejects(
    () => prepareRelease(root, path.join(root, 'src/new-release')),
    /开发|development/,
  );
});

test('requires matching package versions and the complete whitelist before copying', async (t) => {
  const { root, out } = await fixture(t);
  await writeFile(
    path.join(root, 'package-lock.json'),
    JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' } } }),
  );
  await assert.rejects(() => prepareRelease(root, out), /版本|version/);
  await writeFile(
    path.join(root, 'package-lock.json'),
    JSON.stringify({ version: '0.1.1', packages: { '': { version: '0.1.1' } } }),
  );
  await rm(path.join(root, 'LICENSE'));
  await assert.rejects(() => prepareRelease(root, out), /LICENSE/);
  await assert.rejects(() => readdir(out), { code: 'ENOENT' });
});

test('rejects symlinks rather than copying undeclared content into the release', async (t) => {
  const { root, out } = await fixture(t);
  await symlink(path.join(root, 'package.json'), path.join(root, 'src/external.json'));
  await assert.rejects(() => prepareRelease(root, out), /符号链接|symlink/);
  await assert.rejects(() => readdir(out), { code: 'ENOENT' });
});
