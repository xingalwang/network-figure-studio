import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsers } from 'prettier/plugins/typescript';

// The SDK's legacy layer helpers and the export renderer are deliberate bridges.
// New concrete rules enter through the builtin composition root, never through core.
const forbiddenLayers = {
  core: ['app', 'workspaces', 'ui', 'adapters', 'persistence', 'builtins'],
  persistence: ['app', 'workspaces', 'ui', 'adapters'],
  plugins: ['app', 'workspaces', 'ui', 'adapters', 'persistence'],
  builtins: ['app', 'workspaces', 'ui', 'adapters', 'persistence'],
  graphics: ['app', 'workspaces', 'ui', 'persistence'],
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
    const required = node.type === 'CallExpression' && node.callee?.name === 'require';
    const moduleImport =
      ['TSImportType', 'TSImportEqualsDeclaration', 'ImportExpression'].includes(node.type) ||
      required ||
      (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
        node.type,
      ) &&
        node.source);
    const literal =
      node.type === 'TSImportType'
        ? node.argument?.literal
        : node.type === 'TSImportEqualsDeclaration'
          ? node.moduleReference?.expression
          : required
            ? node.arguments[0]
            : node.source;
    if (moduleImport) {
      const specifier =
        typeof literal?.value === 'string'
          ? literal.value
          : literal?.type === 'TemplateLiteral' && !literal.expressions.length
            ? literal.quasis[0].value.cooked
            : null;
      const typeOnly =
        node.type === 'TSImportType' ||
        node.importKind === 'type' ||
        node.exportKind === 'type' ||
        (!!node.specifiers?.length &&
          node.specifiers.every((s) => s.importKind === 'type' || s.exportKind === 'type'));
      imports.push({ specifier, line: node.loc.start.line, typeOnly });
    }
    for (const [key, value] of Object.entries(node))
      if (!['loc', 'range', 'comments', 'tokens'].includes(key)) visit(value);
  }
  visit(ast);
  return imports;
}

export function boundaryViolation(file, specifier, { typeOnly = false } = {}) {
  if (specifier === null)
    return '模块路径必须是静态字符串，才能验证依赖边界；扩展只在构建期显式注册。';
  const layer = file.startsWith('src/') ? file.split('/')[1] : undefined;
  const pluginExample = file.startsWith('examples/plugins/');
  const target = specifier.startsWith('.')
    ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
    : /^(?:\/)?(?:src|examples)\//.test(specifier)
      ? path.posix.normalize(specifier.replace(/^\//, ''))
      : undefined;
  const targetLayer = target?.startsWith('src/') ? target.split('/')[1] : undefined;
  if (file.startsWith('src/core/computation/') && targetLayer !== 'core')
    return '通用计算分析只依赖 core；具体算子通过注册定义传入。';
  if (
    (['core', 'persistence', 'plugins', 'builtins'].includes(layer) || pluginExample) &&
    /^(react(?:-dom)?|@maxgraph\/core)(?:\/|$)/.test(specifier)
  )
    return '非界面模块不能依赖 React 或 maxGraph；通过文档、图元与公开接口交互。';
  if (!target) return undefined;
  if (forbiddenLayers[layer]?.includes(targetLayer))
    return `${layer} 不能反向依赖 ${targetLayer}。`;
  if (layer === 'core' && targetLayer === 'plugins' && !typeOnly)
    return 'core 只使用插件类型合同，不加载插件注册与执行；通用参数验证放在 core。';
  if (
    layer === 'core' &&
    targetLayer === 'graphics' &&
    !(
      file === 'src/core/document/types.ts' &&
      typeOnly &&
      /^src\/graphics\/primitives(?:\.ts)?$/.test(target)
    )
  )
    return 'core 只共享 graphics/primitives 的值类型，几何生成与渲染留在 graphics。';
  if (
    layer === 'plugins' &&
    targetLayer === 'builtins' &&
    !(file === 'src/plugins/sdk.ts' && /^src\/builtins\/layers(?:\.ts)?$/.test(target))
  )
    return '插件运行边界不依赖内置能力；仅 SDK 保留既有 layers 兼容桥。';
  if (file.startsWith('src/app/editor/') && targetLayer === 'workspaces')
    return '编辑协调层拥有编辑模型与动作，不依赖工作区视图。';
  if (layer === 'ui' && targetLayer && targetLayer !== 'ui')
    return '界面基础控件不依赖业务状态、工作区或编辑动作。';
  if (
    layer === 'workspaces' &&
    !typeOnly &&
    /^src\/core\/(commands\/store|tensor-composition|generation\/draft|computation\/(?:index|propagation))(?:\.ts)?$/.test(
      target,
    )
  )
    return '工作区消费编辑状态与完整动作，不创建临时工程或拼装生成分析流程。';
  if (file.startsWith('src/workspaces/generator/') && target.startsWith('src/workspaces/drawing/'))
    return '组装与图稿通过共享画布宿主和编辑合同复用，不反向引用另一工作区。';
  if (
    file.startsWith('src/workspaces/shared/') &&
    /^src\/workspaces\/(generator|drawing)\//.test(target)
  )
    return '共享工作区组件不依赖具体工作区。';
  if (pluginExample && target.startsWith('src/') && !/^src\/plugins\/sdk(?:\.ts)?$/.test(target))
    return '插件示例只能通过 src/plugins/sdk.ts 使用宿主能力。';
  if (target.startsWith('examples/plugins/')) {
    if (!pluginExample && file !== 'src/builtins/registry.ts')
      return '扩展示例仅由 src/builtins/registry.ts 组合注册，宿主实现不依赖示例。';
    if (pluginExample && file.split('/')[2] !== target.split('/')[2])
      return '每个扩展示例独立组织；共享宿主能力通过公开 SDK 使用。';
  }
  return undefined;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(file)));
    else if (/\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)) files.push(file);
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
      const reason = boundaryViolation(file, reference.specifier, reference);
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
      console.error(`${file}:${line} → ${specifier ?? '[动态模块路径]'}\n  ${reason}`);
    if (violations.length) process.exitCode = 1;
    else console.log(`模块边界检查通过：${files} 个源码与插件示例文件。`);
  } catch (error) {
    console.error(`模块边界检查失败：${error.message}`);
    process.exitCode = 1;
  }
}
