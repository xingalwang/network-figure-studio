import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsers } from 'prettier/plugins/typescript';

// Protect established boundaries, not an imaginary fully independent package graph.
// graphics/export.ts intentionally bridges the document and maxGraph renderer.
const forbiddenLayers = {
  core: ['app', 'workspaces', 'adapters', 'persistence'],
  persistence: ['app', 'workspaces', 'adapters'],
  plugins: ['app', 'workspaces', 'adapters', 'persistence'],
  builtins: ['app', 'workspaces', 'adapters', 'persistence'],
  graphics: ['app', 'workspaces', 'persistence'],
};

export async function collectImports(source, file) {
  const ast = await parsers.typescript.parse(source, { filepath: file });
  const imports = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const literal =
      node.type === 'TSImportType'
        ? node.argument?.literal
        : [
              'ImportDeclaration',
              'ExportNamedDeclaration',
              'ExportAllDeclaration',
              'ImportExpression',
            ].includes(node.type)
          ? node.source
          : undefined;
    if (typeof literal?.value === 'string')
      imports.push({ specifier: literal.value, line: node.loc.start.line });
    for (const [key, value] of Object.entries(node))
      if (!['loc', 'range', 'comments', 'tokens'].includes(key)) visit(value);
  }
  visit(ast);
  return imports;
}

export function boundaryViolation(file, specifier) {
  const layer = file.startsWith('src/') ? file.split('/')[1] : undefined;
  const pluginExample = file.startsWith('examples/plugins/');
  if (
    (['core', 'persistence', 'plugins', 'builtins'].includes(layer) || pluginExample) &&
    /^(react(?:-dom)?|@maxgraph\/core)(?:\/|$)/.test(specifier)
  )
    return '非界面模块不能依赖 React 或 maxGraph；通过文档、图元与公开接口交互。';
  if (!specifier.startsWith('.')) return undefined;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  const targetLayer = target.startsWith('src/') ? target.split('/')[1] : undefined;
  if (forbiddenLayers[layer]?.includes(targetLayer))
    return `${layer} 不能反向依赖 ${targetLayer}。`;
  if (file.startsWith('src/app/editor/') && /^src\/workspaces\/(drawing|generator)\//.test(target))
    return '编辑协调层使用共享编辑模型，不依赖具体工作区面板。';
  if (pluginExample && target.startsWith('src/') && target !== 'src/plugins/sdk.ts')
    return '插件示例只能通过 src/plugins/sdk.ts 使用宿主能力。';
  return undefined;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(file)));
    else if (/\.tsx?$/.test(entry.name)) files.push(file);
  }
  return files;
}

export async function checkArchitecture(root) {
  const files = [
    ...(await sourceFiles(path.join(root, 'src'))),
    ...(await sourceFiles(path.join(root, 'examples/plugins'))),
  ];
  const violations = [];
  for (const absolute of files) {
    const file = path.relative(root, absolute).split(path.sep).join('/');
    for (const reference of await collectImports(await readFile(absolute, 'utf8'), file)) {
      const reason = boundaryViolation(file, reference.specifier);
      if (reason) violations.push({ file, ...reference, reason });
    }
  }
  return { files: files.length, violations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const { files, violations } = await checkArchitecture(root);
    for (const { file, line, specifier, reason } of violations)
      console.error(`${file}:${line} → ${specifier}\n  ${reason}`);
    if (violations.length) process.exitCode = 1;
    else console.log(`模块边界检查通过：${files} 个源码与插件示例文件。`);
  } catch (error) {
    console.error(`模块边界检查失败：${error.message}`);
    process.exitCode = 1;
  }
}
