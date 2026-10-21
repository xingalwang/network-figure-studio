import { expect, test } from 'vitest';
import {
  fontFamily,
  fontEmbeddingPermission,
  requestLocalFontEmbedding,
} from '../../src/graphics/typography.ts';

function fontBytes(fsType: number, includePolicy = true): ArrayBuffer {
  const bytes = new ArrayBuffer(44),
    view = new DataView(bytes);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, includePolicy ? 1 : 0);
  for (const [i, c] of [...'OS/2'].entries()) view.setUint8(12 + i, c.charCodeAt(0));
  view.setUint32(20, 32);
  view.setUint32(24, 12);
  view.setUint16(40, fsType);
  return bytes;
}

test('the shared font policy prefers Times New Roman and SimSun with an explicit Noto fallback', () => {
  expect(fontFamily).toBe('Times New Roman, SimSun, Noto Sans SC, serif');
});

test('editable SVG embedding rejects restricted, print-only and bitmap-only fonts', () => {
  for (const flag of [0x0002, 0x0004, 0x0200, 0x0208])
    expect(() => fontEmbeddingPermission(fontBytes(flag))).toThrow();
  expect(fontEmbeddingPermission(fontBytes(0))).toBe(0);
  expect(fontEmbeddingPermission(fontBytes(0x0008))).toBe(0x0008);
  expect(fontEmbeddingPermission(fontBytes(0x0108))).toBe(0x0108);
  expect(() => fontEmbeddingPermission(fontBytes(0, false))).toThrow(/嵌入/);
  expect(() => fontEmbeddingPermission(new ArrayBuffer(3))).toThrow(/字体/);
});

test('local-font permission failures stay explicit and never substitute bundled fonts', async () => {
  await expect(requestLocalFontEmbedding()).rejects.toThrow(/不支持/);
  await expect(
    requestLocalFontEmbedding(async () => {
      throw new Error('denied');
    }),
  ).rejects.toThrow(/授权/);
  await expect(requestLocalFontEmbedding(async () => [])).rejects.toThrow(/Times New Roman/);
});

test('local embedding uses only the selected exact faces and enforces their embedding flags', async () => {
  const query = async () => [
    {
      family: 'Times New Roman',
      postscriptName: 'TimesNewRomanPSMT',
      blob: async () => new Blob([fontBytes(8)]),
    },
    { family: 'SimSun', postscriptName: 'SimSun', blob: async () => new Blob([fontBytes(8)]) },
  ];
  const fonts = await requestLocalFontEmbedding(query);
  expect(fonts.map((font) => font.family)).toEqual(['Times New Roman', 'SimSun']);
  expect(fonts.every((font) => font.dataUrl.startsWith('data:font/ttf;base64,'))).toBe(true);
  await expect(
    requestLocalFontEmbedding(async () => [
      ...(await query()).slice(0, 1),
      { family: 'SimSun', postscriptName: 'SimSun', blob: async () => new Blob([fontBytes(4)]) },
    ]),
  ).rejects.toThrow(/SimSun.*预览/);
});
