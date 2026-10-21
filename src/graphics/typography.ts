/** One policy for the application, editable SVG text and raster exports. */
export const fontFamily = 'Times New Roman, SimSun, Noto Sans SC, serif';
export const rasterFontProbes = ['H', '田'] as const;
export type EmbeddedFont = {
  family: string;
  dataUrl: string;
  weight: string;
  style: string;
  notice: string;
};
type LocalFont = { family: string; postscriptName: string; blob(): Promise<Blob> };
type LocalFontQuery = (options?: { postscriptNames: string[] }) => Promise<LocalFont[]>;
type Typography = { missing: string[]; rasterFonts: EmbeddedFont[] };
const localFaces = [
  { family: 'Times New Roman', postscriptName: 'TimesNewRomanPSMT' },
  { family: 'SimSun', postscriptName: 'SimSun' },
];
let prepared: Promise<Typography> | undefined;

async function fontDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:font/ttf;base64,${btoa(binary)}`;
}

async function localAvailable(family: string): Promise<boolean> {
  try {
    await new FontFace('NNFigure local availability', `local("${family}")`).load();
    return true;
  } catch {
    return false;
  }
}

/** System references require no enumeration permission. Missing SimSun uses the existing OFL fallback. */
export function prepareTypography(): Promise<Typography> {
  prepared ??= (async () => {
    const available = await Promise.all(localFaces.map((font) => localAvailable(font.family)));
    const missing = localFaces.filter((_, index) => !available[index]).map((font) => font.family);
    const rasterFonts: EmbeddedFont[] = [];
    if (!available[1]) {
      const [response, noticeResponse] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}fonts/noto-sans-sc-variable.ttf`),
        fetch(`${import.meta.env.BASE_URL}fonts/NOTO-SANS-SC-OFL.txt`),
      ]);
      if (!response.ok || !noticeResponse.ok) throw Error('无法加载 Noto Sans SC 中文回退字体。');
      const bytes = await response.arrayBuffer();
      const face = await new FontFace('Noto Sans SC', bytes, { weight: '100 900' }).load();
      document.fonts.add(face);
      rasterFonts.push({
        family: 'Noto Sans SC',
        dataUrl: await fontDataUrl(new Blob([bytes])),
        weight: '100 900',
        style: 'normal',
        notice: await noticeResponse.text(),
      });
    }
    await waitForTypographyLayout();
    return { missing, rasterFonts };
  })().catch((error) => {
    prepared = undefined;
    throw error instanceof Error ? error : Error('字体尚未就绪，请重试。');
  });
  return prepared;
}

/** Layout may use settled system fallbacks after a reported font failure; exports still require prepareTypography. */
export async function waitForTypographyLayout(): Promise<void> {
  await document.fonts.load(`14px ${fontFamily}`, 'H田');
  await document.fonts.ready;
}

export function initializeTypography(): void {
  document.documentElement.style.setProperty('--studio-font-family', fontFamily);
}

type FontTable = { offset: number; length: number };
function fontTables(bytes: ArrayBuffer): { view: DataView; tables: Map<string, FontTable> } {
  if (bytes.byteLength < 12) throw Error('本机字体数据不完整。');
  const view = new DataView(bytes),
    signature = view.getUint32(0);
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(signature))
    throw Error('当前本机字体容器不支持安全检查，请使用字体引用或 PNG。');
  const count = view.getUint16(4),
    tables = new Map<string, FontTable>();
  if (12 + count * 16 > bytes.byteLength) throw Error('本机字体目录不完整。');
  for (let index = 0; index < count; index++) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(...new Uint8Array(bytes, record, 4));
    const offset = view.getUint32(record + 8),
      length = view.getUint32(record + 12);
    if (offset + length > bytes.byteLength) throw Error('本机字体表超出数据范围。');
    tables.set(tag, { offset, length });
  }
  return { view, tables };
}

/** Editable SVG needs installable/editable outlines; full-font embedding respects no-subsetting. */
export function fontEmbeddingPermission(bytes: ArrayBuffer): number {
  const { view, tables } = fontTables(bytes),
    policy = tables.get('OS/2');
  if (!policy || policy.length < 10) throw Error('无法确认字体的文档嵌入权限。');
  const flags = view.getUint16(policy.offset + 8);
  if (flags & 0x0002) throw Error('字体禁止文档嵌入，请使用字体引用或 PNG。');
  if (flags & 0x0200) throw Error('字体只允许位图嵌入，不能写入可编辑 SVG。');
  if (flags & 0x0004 && !(flags & 0x0008))
    throw Error('字体仅允许预览和打印嵌入，不能写入可编辑 SVG。');
  return flags;
}

function fontNotices(bytes: ArrayBuffer): string {
  const { view, tables } = fontTables(bytes),
    name = tables.get('name');
  if (!name || name.length < 6) return '';
  const count = view.getUint16(name.offset + 2),
    strings = name.offset + view.getUint16(name.offset + 4);
  if (6 + count * 12 > name.length) return '';
  const notices = new Set<string>();
  for (let index = 0; index < count; index++) {
    const record = name.offset + 6 + index * 12,
      platform = view.getUint16(record);
    if (![0, 3].includes(platform) || ![0, 13, 14].includes(view.getUint16(record + 6))) continue;
    const length = view.getUint16(record + 8),
      offset = strings + view.getUint16(record + 10);
    if (offset < name.offset || offset + length > name.offset + name.length || length % 2) continue;
    const notice = new TextDecoder('utf-16be').decode(new Uint8Array(bytes, offset, length));
    if (notice.trim()) notices.add(notice);
  }
  return [...notices].join('\n');
}

/** Invoke directly from a user click; bytes stay in memory and only enter that requested SVG. */
export async function requestLocalFontEmbedding(query?: LocalFontQuery): Promise<EmbeddedFont[]> {
  const access =
    query ??
    (typeof window === 'undefined'
      ? undefined
      : (window as unknown as { queryLocalFonts?: LocalFontQuery }).queryLocalFonts?.bind(window));
  if (!access) throw Error('此浏览器不支持本机字体读取；请关闭字体内嵌，或导出 PNG。');
  let fonts: LocalFont[];
  try {
    fonts = await access({ postscriptNames: localFaces.map((font) => font.postscriptName) });
  } catch {
    throw Error('未获得本机字体读取授权；请关闭字体内嵌，或导出 PNG。');
  }
  return Promise.all(
    localFaces.map(async (required) => {
      const font = fonts.find((item) => item.postscriptName === required.postscriptName);
      if (!font) throw Error(`未获得 ${required.family} 字体；请关闭字体内嵌，或导出 PNG。`);
      try {
        const blob = await font.blob(),
          bytes = await blob.arrayBuffer();
        const flags = fontEmbeddingPermission(bytes);
        return {
          family: required.family,
          dataUrl: await fontDataUrl(blob),
          weight: '400',
          style: 'normal',
          notice: `${font.postscriptName} · OS/2 fsType ${flags}\n${fontNotices(bytes)}`,
        };
      } catch (error) {
        throw Error(
          `${required.family}：${error instanceof Error ? error.message : '无法读取字体。'}`,
        );
      }
    }),
  );
}

export function embeddedFontCss(fonts: readonly EmbeddedFont[]): string {
  return fonts
    .map(
      (font) =>
        `@font-face{font-family:'${font.family}';font-style:${font.style};font-weight:${font.weight};src:url('${font.dataUrl}') format('truetype');}`,
    )
    .join('\n');
}
