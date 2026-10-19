import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  symlink,
  realpath,
  chmod,
} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(project, 'scripts/launch-local.sh');
const vite = path.join(project, 'node_modules/vite/bin/vite.js');

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jiagoutu-launch-test-'));
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  await mkdir(path.join(root, 'scripts'));
  await writeFile(
    path.join(root, 'scripts/launch-local.sh'),
    (await readFile(source, 'utf8')).replace('PORT=4173', `PORT=${port}`),
  );
  return { root, port, script: path.join(root, 'scripts/launch-local.sh') };
}

function run(script, env = process.env) {
  return spawnSync('bash', [script], { encoding: 'utf8', timeout: 30000, env });
}

function listener(port) {
  const output = spawnSync('ss', ['-H', '-ltnp', `sport = :${port}`], { encoding: 'utf8' }).stdout;
  return Number(output.match(/pid=(\d+)/)?.[1] ?? 0);
}

async function stopOwnedServer(port, root) {
  const pid = listener(port);
  if (pid) {
    assert.equal(await realpath(`/proc/${pid}/cwd`), root);
    process.kill(pid, 'SIGTERM');
  }
}

test('missing build explains repair and does not build or start anything', async () => {
  const f = await fixture();
  try {
    const result = run(f.script);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dist.*npm run build/s);
    assert.equal(listener(f.port), 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('an occupied foreign port is rejected without stopping its owner', async () => {
  const f = await fixture();
  const foreign = net.createServer((socket) => socket.end('not this application'));
  try {
    await mkdir(path.join(f.root, 'dist'));
    await writeFile(path.join(f.root, 'dist/index.html'), '<title>fixture</title>');
    await new Promise((resolve) => foreign.listen(f.port, '127.0.0.1', resolve));
    const result = run(f.script);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /其他|身份|占用/);
    assert.equal(foreign.listening, true);
  } finally {
    await new Promise((resolve) => foreign.close(resolve));
    await rm(f.root, { recursive: true, force: true });
  }
});

test('starts an existing build and repeated launch reuses the same server', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, 'dist'));
    await writeFile(
      path.join(f.root, 'dist/index.html'),
      '<!doctype html><title>launcher fixture</title>',
    );
    await symlink(path.join(project, 'node_modules'), path.join(f.root, 'node_modules'));
    await writeFile(
      path.join(f.root, 'package.json'),
      JSON.stringify({
        scripts: {
          start: `node '${vite}' preview --host 127.0.0.1 --port ${f.port} --strictPort`,
        },
      }),
    );
    const first = run(f.script);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout.trim(), `http://127.0.0.1:${f.port}/`);
    const pid = listener(f.port);
    assert.ok(pid > 0);
    const second = run(f.script);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(listener(f.port), pid);
    // DrvFS can preserve a different path spelling for an existing service.
    // Emulate an equivalent cwd spelling on every filesystem, without changing the server.
    const tools = path.join(f.root, 'tools');
    await mkdir(tools);
    const readlink = path.join(tools, 'readlink');
    await writeFile(
      readlink,
      `#!/usr/bin/env bash
if [[ "$1" == '-f' && "$2" == /proc/*/cwd ]]; then
  printf '%s\\n' ${JSON.stringify(f.root + '/.')}
else
  exec /usr/bin/readlink "$@"
fi
`,
    );
    await chmod(readlink, 0o755);
    const equivalent = run(f.script, { ...process.env, PATH: `${tools}:${process.env.PATH}` });
    assert.equal(equivalent.status, 0, equivalent.stderr);
    assert.equal(listener(f.port), pid);
  } finally {
    await stopOwnedServer(f.port, f.root);
    await rm(f.root, { recursive: true, force: true });
  }
});
