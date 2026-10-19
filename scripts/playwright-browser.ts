import { existsSync } from 'node:fs';
import path from 'node:path';

interface BrowserLocation {
  projectRoot: string;
  defaultExecutablePath: string;
  env?: NodeJS.ProcessEnv;
}

/** Keep Playwright's default selection unless this checkout has its matching browser. */
export function resolveChromiumExecutable({
  projectRoot,
  defaultExecutablePath,
  env = process.env,
}: BrowserLocation): string | undefined {
  if (env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  if (env.PLAYWRIGHT_BROWSERS_PATH !== undefined || existsSync(defaultExecutablePath)) {
    return undefined;
  }

  // Playwright owns the revision and platform layout; do not guess another installed version.
  const segments = defaultExecutablePath.split(/[\\/]/);
  const browserDirectory = segments.findIndex((segment) => /^chromium-\d+$/.test(segment));
  if (browserDirectory === -1) return undefined;
  const localExecutable = path.join(
    projectRoot,
    'node_modules',
    '.cache',
    'ms-playwright',
    ...segments.slice(browserDirectory),
  );
  return existsSync(localExecutable) ? localExecutable : undefined;
}
