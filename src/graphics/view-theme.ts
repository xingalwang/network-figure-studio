/** Only the editor's structure projection uses these colors. Figure export never does. */
export type ViewTheme = 'dark' | 'light';
export const structurePalette = (theme: ViewTheme = 'dark') =>
  theme === 'light'
    ? {
        text: '#243140',
        muted: '#526173',
        edge: '#465765',
        surface: '#fbfcfe',
        node: '#edf1f5',
        border: '#718394',
        error: '#a44137',
      }
    : {
        text: '#e0e5eb',
        muted: '#aeb8c3',
        edge: '#9aaec1',
        surface: '#171c23',
        node: '#252e38',
        border: '#718394',
        error: '#e6a89d',
      };
