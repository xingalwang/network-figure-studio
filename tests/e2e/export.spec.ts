import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { buildBlockGeometry } from '../../src/graphics/block-geometry.ts';
import type { NodeEntity, ProjectDocument } from '../../src/core/document/types.ts';
import { makeEmptyProject } from '../fixtures/project.ts';

function exportFixture(): ProjectDocument {
  const doc = makeEmptyProject();
  for (const [index, angleDeg] of [0, 30, 90, 0].entries()) {
    const generated = buildBlockGeometry(
      { width: 100, height: 70 },
      {
        mode: index === 3 ? 'flat' : 'axonometric',
        depth: 96,
        stackCount: 3,
        stackGap: 6,
        angleDeg,
      },
      { label: index === 0 ? '编码器' : `投影 ${angleDeg}°` },
    );
    if (!generated.ok) throw Error(generated.error.message);
    const id = `node-${index}`;
    doc.entities[id] = {
      id,
      kind: 'node',
      parentId: null,
      name: id,
      size: { width: 100, height: 70 },
      ...generated.value,
      presentation: { position: { x: 80 + (index % 3) * 260, y: index === 3 ? 430 : 220 } },
    };
  }
  (doc.entities['node-1'] as NodeEntity).presentation.labelOverride =
    '中文长标签：编码器的多尺度特征融合输出';
  doc.assets.logo = {
    mime: 'image/png',
    width: 16,
    height: 16,
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPUlEQVR4AdzQMREAMAgDwLaG6gUPqMIDXlAEewYY2MJdBpbc5d9ZHmNBmGQXJGM0wI3Tz2jw1W8XNCEwKAAAAP//Thts8QAAAAZJREFUAwA8pyAhCUVTbgAAAABJRU5ErkJggg==',
  };
  doc.entities.image = {
    id: 'image',
    kind: 'node',
    parentId: null,
    name: '透明图片',
    size: { width: 40, height: 40 },
    bounds: { x: 0, y: 0, width: 40, height: 40 },
    ports: {},
    presentation: { position: { x: 850, y: 250 } },
    primitives: [{ kind: 'image', assetId: 'logo', x: 0, y: 0, width: 40, height: 40 }],
  };
  doc.entities.curve = {
    id: 'curve',
    kind: 'edge',
    parentId: null,
    name: '曲线',
    source: { kind: 'port', entityId: 'node-0', portId: 'out' },
    target: { kind: 'port', entityId: 'node-2', portId: 'in' },
    route: {
      kind: 'curve',
      mode: 'manual',
      spaceId: null,
      points: [
        { x: 300, y: 70 },
        { x: 500, y: 360 },
      ],
    },
    style: { color: '#374151', width: 6, dashed: true, arrow: true },
  };
  return doc;
}

const options = {
  range: 'content' as const,
  margin: 24,
  background: 'transparent' as const,
  width: 1600,
  height: 900,
  embedFonts: false,
};

test.beforeEach(async ({ page }) => {
  await page.goto('/__test__/canvas');
  await page.waitForFunction(() => typeof window.__studio?.exportSvg === 'function');
});

test('SVG contains editable Chinese text, vector shapes and exactly one embedded user image', async ({
  page,
}) => {
  const result = await page.evaluate(
    async ({ docJson, options }) => {
      const doc = JSON.parse(docJson) as ProjectDocument;
      const before = JSON.stringify(window.__studio.snapshot());
      const svg = await (await window.__studio.exportSvg(doc, options)).text();
      const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const images = [...xml.querySelectorAll('image')];
      const imageHref =
        images[0]?.getAttribute('href') ?? images[0]?.getAttribute('xlink:href') ?? '';
      const bitmap = await createImageBitmap(await (await fetch(imageHref)).blob());
      const imageCanvas = document.createElement('canvas');
      imageCanvas.width = 16;
      imageCanvas.height = 16;
      const imageContext = imageCanvas.getContext('2d')!;
      imageContext.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        error: xml.querySelector('parsererror')?.textContent,
        forbidden: /foreignObject|<script|blob:/.test(svg),
        texts: [...xml.querySelectorAll('text')].map((node) => node.textContent).join(''),
        shortLabelCenter: Number(
          [...xml.querySelectorAll('text')]
            .find((node) => node.textContent === '编码器')
            ?.getAttribute('x'),
        ),
        families: [...xml.querySelectorAll('[font-family]')]
          .map((node) => node.getAttribute('font-family'))
          .join(','),
        vectors: xml.querySelectorAll('path,polygon,rect,ellipse').length,
        images: images.length,
        embeddedImage:
          images[0]?.getAttribute('href') === doc.assets.logo.data ||
          images[0]?.getAttribute('xlink:href') === doc.assets.logo.data,
        imageAlpha: [
          imageContext.getImageData(0, 0, 1, 1).data[3],
          imageContext.getImageData(8, 8, 1, 1).data[3],
        ],
        externalLinks: [...xml.querySelectorAll('*')]
          .flatMap((node) => [...node.attributes])
          .filter((attr) => /href$/i.test(attr.name) && !/^(data:|#)/.test(attr.value)).length,
        width: xml.documentElement.getAttribute('width'),
        height: xml.documentElement.getAttribute('height'),
        unchanged: before === JSON.stringify(window.__studio.snapshot()),
      };
    },
    { docJson: JSON.stringify(exportFixture()), options },
  );
  expect(result.error).toBeUndefined();
  expect(result.forbidden).toBe(false);
  expect(result.texts).toContain('编码器');
  expect(result.texts).toContain('中文长标签');
  expect(result.shortLabelCenter).toBe(130);
  expect(result.families).toContain('Inter, Noto Sans SC, sans-serif');
  expect(result.families).not.toContain('NNFigure');
  expect(result.vectors).toBeGreaterThan(3);
  expect(result.images).toBe(1);
  expect(result.embeddedImage).toBe(true);
  expect(result.imageAlpha).toEqual([0, 255]);
  expect(result.externalLinks).toBe(0);
  expect([result.width, result.height]).toEqual(['1600', '900']);
  expect(result.unchanged).toBe(true);
});

test('selection exports only its entities and an empty selection is an error', async ({ page }) => {
  const result = await page.evaluate(
    async ({ docJson, options }) => {
      const doc = JSON.parse(docJson) as ProjectDocument;
      const svg = await (
        await window.__studio.exportSvg(doc, {
          ...options,
          range: 'selection',
          selection: ['node-0'],
        })
      ).text();
      const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
      let emptyRejected = false;
      try {
        await window.__studio.exportSvg(doc, { ...options, range: 'selection', selection: [] });
      } catch {
        emptyRejected = true;
      }
      return {
        text: [...xml.querySelectorAll('text')].map((node) => node.textContent).join(''),
        images: xml.querySelectorAll('image').length,
        emptyRejected,
      };
    },
    { docJson: JSON.stringify(exportFixture()), options },
  );
  expect(result.text).toContain('编码器');
  expect(result.text).not.toContain('中文长标签');
  expect(result.images).toBe(0);
  expect(result.emptyRejected).toBe(true);
});

test('page export uses the requested board range and rejects invalid output dimensions', async ({
  page,
}) => {
  const result = await page.evaluate(
    async ({ docJson, options }) => {
      const doc = JSON.parse(docJson) as ProjectDocument;
      const svg = await (
        await window.__studio.exportSvg(doc, {
          ...options,
          range: 'page',
          margin: 0,
          width: 1200,
          height: 700,
        })
      ).text();
      const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const rejected = [];
      for (const width of [0, -1, NaN, Infinity, 1.5]) {
        try {
          await window.__studio.exportPng(doc, { ...options, width });
          rejected.push(false);
        } catch {
          rejected.push(true);
        }
      }
      return { viewBox: xml.documentElement.getAttribute('viewBox'), rejected };
    },
    { docJson: JSON.stringify(exportFixture()), options },
  );
  expect(result.viewBox).toBe('0 0 1200 700');
  expect(result.rejected).toEqual([true, true, true, true, true]);
});

test('SVG embeds both local fonts by default while keeping native text', async ({ page }) => {
  const result = await page.evaluate(
    async ({ docJson, options }) => {
      const doc = JSON.parse(docJson) as ProjectDocument;
      const { embedFonts: _ignored, ...defaults } = options;
      const blob = await window.__studio.exportSvg(doc, defaults);
      const xml = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
      const style = [...xml.querySelectorAll('style')].map((node) => node.textContent).join('');
      return {
        fonts: (style.match(/@font-face/g) ?? []).length,
        embedded: (style.match(/data:font\/ttf;base64,/g) ?? []).length,
        text: xml.querySelectorAll('text').length,
        bytes: blob.size,
        licenses: xml.querySelector('metadata')?.textContent ?? '',
      };
    },
    { docJson: JSON.stringify(exportFixture()), options },
  );
  expect(result.fonts).toBe(2);
  expect(result.embedded).toBe(2);
  expect(result.text).toBeGreaterThan(0);
  expect(result.bytes).toBeGreaterThan(1_000_000);
  expect(result.licenses).toContain('SIL OPEN FONT LICENSE');
  expect(result.licenses).toContain('The Inter Project Authors');
  expect(result.licenses).toContain('Adobe');
});

test('font loading failures name the missing font instead of silently exporting fallback glyphs', async ({
  page,
}) => {
  await page.route('**/fonts/noto-sans-sc-variable.ttf', (route) => route.abort());
  const failure = await page.evaluate(
    async ({ docJson, options }) => {
      try {
        await window.__studio.exportSvg(JSON.parse(docJson), options);
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    { docJson: JSON.stringify(exportFixture()), options },
  );
  expect(failure).toContain('Noto Sans SC');
  await page.unroute('**/fonts/noto-sans-sc-variable.ttf');
  const recovered = await page.evaluate(
    async ({ docJson, options }) => {
      const blob = await window.__studio.exportSvg(JSON.parse(docJson), options);
      return blob.type.startsWith('image/svg+xml');
    },
    { docJson: JSON.stringify(exportFixture()), options },
  );
  expect(recovered).toBe(true);
});

test('the exported viewBox contains actual projected shapes, arrow paths and long-label glyphs', async ({
  page,
}, testInfo) => {
  const bounds = await page.evaluate(
    async ({ docJson, options }) => {
      const doc = JSON.parse(docJson) as ProjectDocument;
      const svg = await (await window.__studio.exportSvg(doc, { ...options, margin: 0 })).text();
      const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = document.importNode(xml.documentElement, true) as unknown as SVGSVGElement;
      root.style.width = '960px';
      root.style.height = '540px';
      document.body.replaceChildren(root);
      const viewBox = root.viewBox.baseVal;
      const content = root.querySelector<SVGGraphicsElement>('[data-export-content]')!.getBBox();
      return {
        left: content.x - viewBox.x,
        top: content.y - viewBox.y,
        right: viewBox.x + viewBox.width - content.x - content.width,
        bottom: viewBox.y + viewBox.height - content.y - content.height,
      };
    },
    { docJson: JSON.stringify(exportFixture()), options },
  );
  expect(Math.min(bounds.left, bounds.top, bounds.right, bounds.bottom)).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('export-preview.png') });
});

test('PNG is the requested size with real transparent or white corners and undistorted content', async ({
  page,
}, testInfo) => {
  const result = await page.evaluate(
    async ({ docJson, options }) => {
      const doc = JSON.parse(docJson) as ProjectDocument;
      const samples = [];
      let png: number[] = [];
      for (const background of ['transparent', 'white']) {
        const blob = await window.__studio.exportPng(doc, { ...options, background });
        if (background === 'transparent') png = [...new Uint8Array(await blob.arrayBuffer())];
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const pixels = [
          [0, 0],
          [canvas.width - 1, 0],
          [0, canvas.height - 1],
          [canvas.width - 1, canvas.height - 1],
        ].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
        samples.push({ width: canvas.width, height: canvas.height, pixels });
      }
      const first = doc.entities['node-0'];
      if (first.kind !== 'node') throw Error('fixture');
      first.size = { width: 100, height: 50 };
      first.bounds = { x: 0, y: 0, ...first.size };
      first.primitives = [
        { kind: 'rect', x: 0, y: 0, ...first.size, fill: '#ff0000', stroke: '#ff0000' },
      ];
      const blob = await window.__studio.exportPng(doc, {
        ...options,
        range: 'selection',
        selection: ['node-0'],
        margin: 0,
        width: 400,
        height: 400,
      });
      const bitmap = await createImageBitmap(blob),
        canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, 400, 400).data;
      let left = 400,
        top = 400,
        right = 0,
        bottom = 0;
      for (let y = 0; y < 400; y++)
        for (let x = 0; x < 400; x++)
          if (pixels[(y * 400 + x) * 4 + 3] > 128) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
      return {
        samples,
        ratio: (right - left + 1) / (bottom - top + 1),
        center: [(left + right + 1) / 2, (top + bottom + 1) / 2],
        png,
      };
    },
    { docJson: JSON.stringify(exportFixture()), options },
  );
  expect(result.samples.map((sample) => [sample.width, sample.height])).toEqual([
    [1600, 900],
    [1600, 900],
  ]);
  expect(result.samples[0].pixels.every((pixel) => pixel[3] === 0)).toBe(true);
  expect(result.samples[1].pixels.every((pixel) => pixel.every((channel) => channel === 255))).toBe(
    true,
  );
  expect(result.ratio).toBeGreaterThan(1.9);
  expect(result.ratio).toBeLessThan(2.1);
  expect(result.center).toEqual([200, 200]);
  await writeFile(testInfo.outputPath('export-transparent.png'), Buffer.from(result.png));
});

for (const entry of ['canvas', 'app'])
  test(`PNG contains Chinese and Latin glyph pixels on the first export from ${entry}`, async ({
    page,
  }) => {
    if (entry === 'app') {
      await page.goto('/');
      await page.waitForFunction(() => typeof window.__studio?.exportPng === 'function');
    }
    const pixels = await page.evaluate(
      async ({ docJson, options }) => {
        const doc = JSON.parse(docJson) as ProjectDocument;
        doc.entities = {
          label: {
            id: 'label',
            kind: 'node',
            name: '文字',
            parentId: null,
            size: { width: 300, height: 80 },
            bounds: { x: 0, y: 0, width: 300, height: 80 },
            presentation: { position: { x: 0, y: 0 } },
            ports: {},
            primitives: [
              {
                kind: 'text',
                x: 0,
                y: 0,
                width: 300,
                height: 80,
                fontSize: 28,
                color: '#26333d',
                text: '编码器 Encoder',
              },
            ],
          },
        };
        await window.__studio.exportSvg(doc, options);
        const png = await window.__studio.exportPng(doc, {
          ...options,
          margin: 0,
          width: 600,
          height: 160,
        });
        const bitmap = await createImageBitmap(png),
          canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 160;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const data = ctx.getImageData(0, 0, 600, 160).data;
        return [...data].filter((value, index) => index % 4 === 3 && value > 0).length;
      },
      { docJson: JSON.stringify(makeEmptyProject()), options },
    );
    expect(pixels).toBeGreaterThan(1000);
  });

test('the export dialog downloads an actual SVG file and offers a separate paper background', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__studio?.load === 'function');
  await page.evaluate(
    (docJson) => window.__studio.load(JSON.parse(docJson)),
    JSON.stringify(exportFixture()),
  );
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导出图稿' })).toBeVisible();
  await page.getByLabel('嵌入字体').uncheck();
  await page.getByLabel('图稿背景').selectOption('transparent');
  await expect(page.getByRole('img', { name: '导出预览' })).toBeVisible();
  const previewHasFonts = await page
    .getByRole('img', { name: '导出预览' })
    .evaluate(async (image) => {
      const svg = await (await fetch((image as HTMLImageElement).src)).text();
      return (svg.match(/@font-face/g) ?? []).length === 2;
    });
  expect(previewHasFonts).toBe(true);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 SVG', exact: true }).click();
  const file = await download,
    path = await file.path();
  expect(file.suggestedFilename()).toMatch(/\.svg$/);
  expect(path).toBeTruthy();
  const svg = await readFile(path!, 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).not.toMatch(/foreignObject|<script|blob:/);
  await page
    .getByRole('img', { name: '导出预览' })
    .evaluate((image) => (image as HTMLImageElement).decode());
  await page
    .getByRole('dialog', { name: '导出图稿' })
    .screenshot({ path: testInfo.outputPath('export-dialog.png') });
});
