# 本地字体资产

收录日期：2026-10-19。两套字体均来自 Google Fonts 官方仓库，按完整发布文件保存，未按界面字表裁剪、转码或修改字形。字体随应用分发，不需要运行时访问 Google Fonts 或 CDN。

| 文件 | 字体内部版本 | 可变轴 | 大小 |
| --- | --- | --- | --- |
| `inter-variable.ttf` | `Version 4.001;git-66647c0bb` | `wght` 100–900；`opsz` 14–32 | 876,576 字节 |
| `noto-sans-sc-variable.ttf` | `Version 2.004-H2;hotconv 1.0.118;makeotfexe 2.5.65603` | `wght` 100–900 | 17,772,300 字节 |

400、500、600 均在真实可变字重范围内，不需要浏览器合成粗体，也不需要另外三份静态字体。Noto 的默认轴值为 100，其内部旧式名称包含 `Thin`；下方声明将它作为完整的 Noto Sans SC 可变字族使用。

## 来源与许可

**Inter**：[字体原文件](https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf)、[官方元数据](https://raw.githubusercontent.com/google/fonts/main/ofl/inter/METADATA.pb)、[原许可](https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt)。上游项目为 [rsms/inter](https://github.com/rsms/inter)，官方元数据记录源提交 `66647c0bbbe41a850d79d9c76fb13add3378940f`。本地许可：`INTER-OFL.txt`。

**Noto Sans SC**：[字体原文件](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf)、[官方元数据](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/METADATA.pb)、[原许可](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt)。上游项目为 [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk)，官方元数据记录源提交 `523d033d6cb47f4a80c58a35753646f5c3608a78`。本地许可：`NOTO-SANS-SC-OFL.txt`。

两套均采用 SIL Open Font License 1.1。分发应用或字体副本时保留对应许可和版权声明；完整条款以同目录原许可为准。这里只更改了文件名，未改字体内部名称或内容。

## 接入示例

根路径部署时，在应用样式中声明：

```css
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-variable.ttf") format("truetype");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}

@font-face {
  font-family: "Noto Sans SC";
  src: url("/fonts/noto-sans-sc-variable.ttf") format("truetype");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}

:root {
  font-family: "Inter", "Noto Sans SC", sans-serif;
  font-optical-sizing: auto;
}

button,
input,
select,
textarea {
  font: inherit;
}
```

应用部署到子路径时，字体 URL 随应用的基础路径调整。字体文件较大，建议保留浏览器缓存；不要为了缩小包体改成仅含固定界面文字的子集，用户输入的中文标签也需要这套字体。

## 已核验的覆盖与元数据

已用 TrueType 表解析及 Fontconfig 检查实际文件，确认两个文件均为有效 TrueType 字体，存在可变轴，表边界有效；两份许可均含 OFL 1.1 正文。

Inter 包含 2,933 个字形、2,849 个 Unicode 码点，用于英文、数字及其支持的符号。Noto Sans SC 包含 31,036 个字形、30,890 个 Unicode 码点，其中 CJK 基本区覆盖 20,976 个码点，扩展 A 区覆盖 6,582 个码点，GB2312 的 6,763 个汉字全部覆盖。中文界面、深度学习术语、自由输入的常用简体标签已做字符映射检查，不依赖固定 UI 字表。

字体并不包含全部 Unicode 历代扩展汉字；例如扩展 B 字符 `𠮷` 不在本文件内，超出覆盖范围时由后备字体处理。后续若要求专名、生僻字的跨机器一致导出，应按实际缺字增加合适字体，而不是声称任一字库覆盖所有汉字。

本次核验针对资产文件及字符映射；实际页面加载、浏览器字形渲染和 SVG／PNG 导出由应用集成流程验证。
