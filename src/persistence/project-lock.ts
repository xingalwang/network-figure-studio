import type { ErrorDetail } from '../core/document/types.ts';

export type ProjectLockManager = {
  request(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: unknown | null) => Promise<void>,
  ): Promise<void>;
};
export type ProjectLockChannel = Pick<
  BroadcastChannel,
  'postMessage' | 'addEventListener' | 'removeEventListener' | 'close'
>;
export type ProjectLockOptions = {
  locks?: ProjectLockManager | null;
  createChannel?: (name: string) => ProjectLockChannel | undefined;
  onAvailable?: () => void;
};
type LeaseBase = { projectId: string; release(): Promise<void> };
export type WritableLease = LeaseBase & { kind: 'writable' };
export type ReadonlyLease = LeaseBase & { kind: 'readonly' };
export type UnavailableLease = LeaseBase & { kind: 'unsupported' | 'failed'; error: ErrorDetail };
export type ProjectLease = WritableLease | ReadonlyLease | UnavailableLease;

export async function acquireProjectLock(
  projectId: string,
  options: ProjectLockOptions = {},
): Promise<ProjectLease> {
  const locks = options.locks === undefined ? globalThis.navigator?.locks : options.locks;
  const unavailable = (kind: 'unsupported' | 'failed', message: string): UnavailableLease => ({
    kind,
    projectId,
    error: { code: kind === 'unsupported' ? 'LOCKS_UNSUPPORTED' : 'LOCK_FAILED', message },
    release: async () => {},
  });
  if (!locks)
    return unavailable(
      'unsupported',
      '此浏览器不支持 Web Locks，不能安全启用可写的浏览器恢复项目；仍可使用独立文件模式。',
    );
  const name = `nnfig:project:${projectId}`;
  let channel: ProjectLockChannel | undefined;
  try {
    channel = options.createChannel
      ? options.createChannel(name)
      : typeof BroadcastChannel === 'function'
        ? new BroadcastChannel(name)
        : undefined;
  } catch {
    /* Notifications are advisory; Web Locks remains authoritative. */
  }
  const onMessage = (event: Event) => {
    const data = (event as MessageEvent).data;
    if (data?.type === 'released' && data.projectId === projectId) options.onAvailable?.();
  };
  const closeChannel = () => {
    channel?.removeEventListener('message', onMessage);
    channel?.close();
  };
  return new Promise<ProjectLease>((resolve) => {
    let unlock!: () => void;
    const held = new Promise<void>((done) => {
      unlock = done;
    });
    let completion: Promise<void>;
    let releasePromise: Promise<void> | undefined;
    try {
      completion = locks.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) {
          channel?.addEventListener('message', onMessage);
          resolve({
            kind: 'readonly',
            projectId,
            release: async () => {
              closeChannel();
            },
          });
          return;
        }
        resolve({
          kind: 'writable',
          projectId,
          release() {
            if (!releasePromise) {
              unlock();
              releasePromise = completion.then(() => {
                try {
                  channel?.postMessage({ type: 'released', projectId });
                } finally {
                  closeChannel();
                }
              });
            }
            return releasePromise;
          },
        });
        await held;
      });
      void completion.catch((error) => {
        closeChannel();
        resolve(
          unavailable(
            'failed',
            `无法确认项目写入锁：${error instanceof Error ? error.message : '请求失败。'}`,
          ),
        );
      });
    } catch (error) {
      closeChannel();
      resolve(
        unavailable(
          'failed',
          `无法确认项目写入锁：${error instanceof Error ? error.message : '请求失败。'}`,
        ),
      );
    }
  });
}
