import {
  ImageExport,
  SvgCanvas2D,
  type AbstractCanvas2D,
  type CellState,
  type Graph,
} from '@maxgraph/core';
import { renderDocumentGraph } from '../adapters/maxgraph/adapter.ts';
import { validColor, validateDocument } from '../core/document/validate.ts';
import type { ProjectDocument } from '../core/document/types.ts';
import type { Bounds } from './primitives.ts';

export type ExportOptions = {
  range: 'content' | 'selection' | 'page';
  selection?: string[];
  /** Margin in document pixels, before fitting to the output dimensions. */
  margin: number;
  background: ProjectDocument['page']['background'];
  width: number;
  height: number;
  /** Defaults to true for portable SVG text. PNG always embeds fonts. */
  embedFonts?: boolean;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
type ExportFont = { family: string; dataUrl: string; license: string; probe: string };
let fontResources: Promise<ExportFont[]> | undefined;

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error('无法读取导出字体。'));
    reader.readAsDataURL(blob);
  });
}

async function loadFonts(): Promise<ExportFont[]> {
  fontResources ??= Promise.all(
    [
      {
        family: 'Inter',
        file: 'inter-variable.ttf',
        licenseFile: 'INTER-OFL.txt',
        sample: 'Encoder 0123',
        probe: 'H',
      },
      {
        family: 'Noto Sans SC',
        file: 'noto-sans-sc-variable.ttf',
        licenseFile: 'NOTO-SANS-SC-OFL.txt',
        sample: '编码器特征图',
        probe: '田',
      },
    ].map(async ({ family, file, licenseFile, sample, probe }) => {
      try {
        const [response, licenseResponse] = await Promise.all(
          [file, licenseFile].map((name) => fetch(`${import.meta.env.BASE_URL}fonts/${name}`)),
        );
        if (!response.ok || !licenseResponse.ok) throw Error('字体或许可证文件读取失败。');
        const [bytes, license] = await Promise.all([
          response.arrayBuffer(),
          licenseResponse.text(),
        ]);
        const font = await new FontFace(family, bytes, {
          weight: '100 900',
          style: 'normal',
        }).load();
        document.fonts.add(font);
        await document.fonts.load(`14px "${family}"`, sample);
        if (!document.fonts.check(`14px "${family}"`, sample)) throw Error('字体尚未就绪。');
        return {
          family,
          license,
          probe,
          dataUrl: await dataUrl(new Blob([bytes], { type: 'font/ttf' })),
        };
      } catch (cause) {
        throw Error(`无法加载 ${family} 字体，请重试导出。`, { cause });
      }
    }),
  ).catch((error) => {
    fontResources = undefined;
    throw error instanceof Error ? error : Error('导出字体加载失败，请重试。');
  });
  const fonts = await fontResources;
  await document.fonts.ready;
  return fonts;
}

function validateOptions(options: ExportOptions, png: boolean): void {
  if (
    !['content', 'selection', 'page'].includes(options.range) ||
    (!['white', 'transparent'].includes(options.background) && !validColor(options.background)) ||
    ![options.width, options.height, options.margin].every(Number.isFinite) ||
    options.width <= 0 ||
    options.height <= 0 ||
    options.margin < 0 ||
    (png && (!Number.isInteger(options.width) || !Number.isInteger(options.height)))
  ) {
    throw Error('导出宽高必须为正数，PNG 宽高必须为整数，边距不能为负数。');
  }
}

function selectedIds(doc: ProjectDocument, options: ExportOptions): Set<string> {
  if (options.range !== 'selection') return new Set(Object.keys(doc.entities));
  const ids = new Set((options.selection ?? []).filter((id) => Object.hasOwn(doc.entities, id)));
  if (ids.size === 0) throw Error('请先选中要导出的对象。');
  let changed = true;
  while (changed) {
    changed = false;
    for (const entity of Object.values(doc.entities))
      if (entity.parentId && ids.has(entity.parentId) && !ids.has(entity.id)) {
        ids.add(entity.id);
        changed = true;
      }
  }
  return ids;
}

function exportBounds(
  graph: Graph,
  doc: ProjectDocument,
  options: ExportOptions,
  ids: Set<string>,
): Bounds {
  if (options.range === 'page')
    return { x: 0, y: 0, width: doc.page.width, height: doc.page.height };
  if (ids.size === 0) throw Error('当前没有可导出的图形。');
  const rectangles = [...ids].flatMap((id) => {
    const cell = graph.getDataModel().getCell(id);
    const state = cell ? graph.getView().getState(cell) : null;
    const bounds = state ? graph.getView().getBoundingBox(state, false) : null;
    return bounds ? [bounds] : [];
  });
  if (!rectangles.length) throw Error('无法确定图形的导出范围。');
  const left = Math.min(...rectangles.map((rect) => rect.x)),
    top = Math.min(...rectangles.map((rect) => rect.y));
  return {
    x: left,
    y: top,
    width: Math.max(...rectangles.map((rect) => rect.x + rect.width)) - left,
    height: Math.max(...rectangles.map((rect) => rect.y + rect.height)) - top,
  };
}

function fittedViewBox(bounds: Bounds, options: ExportOptions): Bounds {
  const box = {
    x: bounds.x - options.margin,
    y: bounds.y - options.margin,
    width: bounds.width + options.margin * 2,
    height: bounds.height + options.margin * 2,
  };
  const aspect = options.width / options.height;
  if (box.width / box.height < aspect) {
    const width = box.height * aspect;
    box.x -= (width - box.width) / 2;
    box.width = width;
  } else {
    const height = box.width / aspect;
    box.y -= (height - box.height) / 2;
    box.height = height;
  }
  if (!Object.values(box).every(Number.isFinite) || box.width <= 0 || box.height <= 0)
    throw Error('导出尺寸或边距过大，无法生成有效图稿。');
  return box;
}

class DocumentImageExport extends ImageExport {
  constructor(private readonly ids: Set<string>) {
    super();
  }
  override drawState(state: CellState, canvas: AbstractCanvas2D): void {
    const states: CellState[] = [];
    this.visitStatesRecursive(state, canvas, (item) => states.push(item));
    // Match the editor's background-edge painting without reordering its model.
    for (const edges of [true, false]) {
      for (const item of states) {
        if (item.cell.isEdge() === edges) this.drawCellState(item, canvas);
      }
    }
  }
  override drawCellState(state: CellState, canvas: AbstractCanvas2D): void {
    const id = state.cell.getId();
    if (id && this.ids.has(id)) super.drawCellState(state, canvas);
  }
}

export async function exportSvg(doc: ProjectDocument, options: ExportOptions): Promise<Blob> {
  validateOptions(options, false);
  const valid = validateDocument(doc);
  if (!valid.ok) throw Error(valid.error.message);
  const ids = selectedIds(doc, options);
  const fonts = await loadFonts();
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText = `position:fixed;left:-100000px;top:0;width:${doc.page.width}px;height:${doc.page.height}px;visibility:hidden;pointer-events:none;`;
  document.body.append(container);
  let graph: Graph | undefined;
  try {
    graph = renderDocumentGraph(container, doc);
    const box = fittedViewBox(exportBounds(graph, doc, options, ids), options);
    const xml = document.implementation.createDocument(SVG_NS, 'svg', null);
    const root = xml.documentElement as unknown as SVGSVGElement;
    root.setAttribute('width', String(options.width));
    root.setAttribute('height', String(options.height));
    root.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
    root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    root.setAttribute('version', '1.1');
    root.setAttribute('overflow', 'hidden');
    if (options.embedFonts !== false) {
      const style = xml.createElementNS(SVG_NS, 'style');
      style.textContent = fonts
        .map(
          (font) =>
            `@font-face{font-family:'${font.family}';font-style:normal;font-weight:100 900;src:url('${font.dataUrl}') format('truetype');}`,
        )
        .join('\n');
      root.append(style);
      const metadata = xml.createElementNS(SVG_NS, 'metadata');
      metadata.textContent = fonts.map((font) => `${font.family}\n${font.license}`).join('\n\n');
      root.append(metadata);
    }
    if (options.background !== 'transparent') {
      const background = xml.createElementNS(SVG_NS, 'rect');
      for (const key of ['x', 'y', 'width', 'height'] as const)
        background.setAttribute(key, String(box[key]));
      background.setAttribute(
        'fill',
        options.background === 'white' ? '#ffffff' : options.background,
      );
      root.append(background);
    }
    const content = xml.createElementNS(SVG_NS, 'g');
    content.setAttribute('data-export-content', '');
    root.append(content);
    const canvas = new SvgCanvas2D(content, false);
    canvas.foEnabled = false;
    canvas.pointerEvents = false;
    const modelRoot = graph.getDataModel().getRoot();
    const state = modelRoot ? graph.getView().getState(modelRoot) : null;
    if (state) new DocumentImageExport(ids).drawState(state, canvas);
    return new Blob([new XMLSerializer().serializeToString(root)], {
      type: 'image/svg+xml;charset=utf-8',
    });
  } finally {
    graph?.destroy();
    container.remove();
  }
}

const PROBE_WIDTH = 64,
  PROBE_HEIGHT = 48,
  PROBE_BASELINE = 36,
  PROBE_SIZE = 32;

async function glyphReference(fonts: ExportFont[]): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = fonts.length * PROBE_WIDTH;
  canvas.height = PROBE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw Error('无法准备字体栅格化检查。');
  for (const [index, font] of fonts.entries()) {
    const family = `NNFigure raster reference ${index}`;
    const face = await new FontFace(family, `url('${font.dataUrl}')`, { weight: '400' }).load();
    document.fonts.add(face);
    try {
      context.font = `${PROBE_SIZE}px "${family}"`;
      context.fillText(font.probe, index * PROBE_WIDTH + 8, PROBE_BASELINE);
    } finally {
      document.fonts.delete(face);
    }
  }
  return canvas;
}

/** Image.decode() does not await SVG web-font rendering. Check the actual glyphs. */
function waitForRasterGlyphs(
  image: HTMLImageElement,
  reference: HTMLCanvasElement,
  offsetY: number,
): Promise<void> {
  const probe = document.createElement('canvas');
  probe.width = reference.width;
  probe.height = reference.height;
  const context = probe.getContext('2d', { willReadFrequently: true });
  const expected = reference
    .getContext('2d')!
    .getImageData(0, 0, reference.width, reference.height).data;
  if (!context) return Promise.reject(Error('无法检查 PNG 字体。'));
  return new Promise((resolve, reject) => {
    let frame = 0;
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
      error ? reject(error) : resolve();
    };
    const timeout = window.setTimeout(
      () => finish(Error('字体栅格化尚未完成，未生成 PNG。请重试。')),
      10_000,
    );
    const check = () => {
      try {
        context.clearRect(0, 0, probe.width, probe.height);
        context.drawImage(
          image,
          0,
          offsetY,
          probe.width,
          probe.height,
          0,
          0,
          probe.width,
          probe.height,
        );
        const actual = context.getImageData(0, 0, probe.width, probe.height).data;
        const cells = reference.width / PROBE_WIDTH,
          differences = Array<number>(cells).fill(0),
          ink = Array<number>(cells).fill(0);
        for (let y = 0; y < probe.height; y++)
          for (let x = 0; x < probe.width; x++) {
            const alpha = (y * probe.width + x) * 4 + 3,
              cell = Math.floor(x / PROBE_WIDTH);
            differences[cell] += Math.abs(actual[alpha] - expected[alpha]);
            ink[cell] += expected[alpha];
          }
        if (ink.every((value, index) => value > 0 && differences[index] / value < 0.05)) finish();
        else frame = requestAnimationFrame(check);
      } catch (error) {
        finish(error instanceof Error ? error : Error('无法检查 PNG 字体。'));
      }
    };
    check();
  });
}

export async function exportPng(doc: ProjectDocument, options: ExportOptions): Promise<Blob> {
  validateOptions(options, true);
  const svg = await exportSvg(doc, { ...options, embedFonts: true });
  const fonts = await loadFonts(),
    reference = await glyphReference(fonts);
  // The extra strip belongs only to this internal raster image, never to SVG exports.
  const xml = new DOMParser().parseFromString(await svg.text(), 'image/svg+xml'),
    figure = xml.documentElement;
  const wrapper = xml.createElementNS(SVG_NS, 'svg');
  wrapper.setAttribute('width', String(Math.max(options.width, reference.width)));
  wrapper.setAttribute('height', String(options.height + PROBE_HEIGHT));
  wrapper.append(figure);
  for (const [index, font] of fonts.entries()) {
    const text = xml.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(index * PROBE_WIDTH + 8));
    text.setAttribute('y', String(options.height + PROBE_BASELINE));
    text.setAttribute('font-family', font.family);
    text.setAttribute('font-size', String(PROBE_SIZE));
    text.setAttribute('fill', '#000000');
    text.textContent = font.probe;
    wrapper.append(text);
  }
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(wrapper)], { type: 'image/svg+xml' }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    await waitForRasterGlyphs(image, reference, options.height);
    const canvas = document.createElement('canvas');
    canvas.width = options.width;
    canvas.height = options.height;
    const context = canvas.getContext('2d');
    if (!context) throw Error('无法创建 PNG 画布，请降低导出尺寸后重试。');
    context.drawImage(
      image,
      0,
      0,
      options.width,
      options.height,
      0,
      0,
      options.width,
      options.height,
    );
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(Error('PNG 生成失败，请降低导出尺寸后重试。'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
