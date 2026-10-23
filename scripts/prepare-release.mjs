import { copyFile, lstat, mkdir, readdir, readFile, realpath, constants } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const releaseFiles = [
  '.gitignore',
  '.node-version',
  '.prettierrc.json',
  'README.md',
  'README.en.md',
  'LICENSE',
  'index.html',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'docs/architecture.md',
  'docs/user-guide.md',
  'docs/images/workbench.png',
  'docs/CONTRIBUTING.md',
  'docs/CHANGELOG.md',
  'docs/THIRD_PARTY_NOTICES.md',
  'docs/project-format.md',
  'docs/plugin-development.md',
];
export const releaseDirectories = [
  'src',
  'tests',
  'public',
  'scripts',
  'examples/plugins',
  'examples/projects',
  '.github/workflows',
];
const excluded = new Set([
  'AGENTS.md',
  '.git',
  'node_modules',
  'dist',
  '.superpowers',
  '.cache',
  '.vite',
  '.vite-temp',
  'test-results',
  'playwright-report',
  'coverage',
  '.DS_Store',
  'Thumbs.db',
]);
const isExcluded = (name) =>
  excluded.has(name) ||
  /^\.env(?:\.|$)/.test(name) ||
  /\.(?:log|tsbuildinfo|local|bak|tmp|bundle)$/.test(name);

async function inventory(root, relative, files) {
  const stat = await lstat(path.join(root, relative));
  if (stat.isSymbolicLink()) throw Error(`上传包不接受符号链接：${relative}`);
  if (stat.isDirectory()) {
    const children = await readdir(path.join(root, relative));
    for (const child of children.sort())
      if (!isExcluded(child)) await inventory(root, `${relative}/${child}`, files);
  } else if (stat.isFile()) files.push(relative);
  else throw Error(`上传包只接受普通文件：${relative}`);
}

export async function prepareRelease(source, destination) {
  const root = await realpath(source);
  const requested = path.resolve(destination);
  const out = path.join(await realpath(path.dirname(requested)), path.basename(requested));
  const relative = path.relative(root, out);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
    throw Error('上传目录必须位于开发工程之外，避免污染源码。');
  try {
    const stat = await lstat(out);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('上传目录不能是文件或符号链接。');
    if ((await readdir(out)).length) throw Error('上传目录非空；不会覆盖已有版本。');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  if (
    !/^\d+\.\d+\.\d+$/.test(packageJson.version) ||
    lock.version !== packageJson.version ||
    lock.packages?.['']?.version !== packageJson.version
  )
    throw Error('package.json与package-lock.json的发布版本必须一致。');
  const files = [];
  for (const entry of [...releaseFiles, ...releaseDirectories]) await inventory(root, entry, files);
  await mkdir(out, { recursive: true });
  for (const file of files.sort()) {
    await mkdir(path.dirname(path.join(out, file)), { recursive: true });
    await copyFile(path.join(root, file), path.join(out, file), constants.COPYFILE_EXCL);
  }
  return { version: packageJson.version, directory: out, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--out')
      throw Error('用法：npm run release:prepare -- --out <已存在父目录下的空版本目录>');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    console.log(JSON.stringify(await prepareRelease(root, args[1]), null, 2));
  } catch (error) {
    console.error(`整理上传包失败：${error.message}`);
    process.exitCode = 1;
  }
}
