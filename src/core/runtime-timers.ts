/** Timer helper for non-request-path runtime scheduling and cleanup bounds. */

export type RuntimeTimer = NodeJS.Timeout;

export const scheduleRuntimeTimer = (
  callback: () => void,
  durationMs: number,
  options: { unref?: boolean } = {},
): RuntimeTimer => {
  const timer = setTimeout(callback, durationMs);
  if (options.unref === true) timer.unref();
  return timer;
};

export const cancelRuntimeTimer = (timer: RuntimeTimer): void => {
  clearTimeout(timer);
};

export const delay = (durationMs: number): Promise<void> => new Promise((resolveDelay) => {
  scheduleRuntimeTimer(resolveDelay, durationMs);
});

export const delayUntilAbort = async (durationMs: number, signal: AbortSignal): Promise<void> => {
  if (durationMs <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = scheduleRuntimeTimer(resolve, durationMs);
    const abort = (): void => {
      cancelRuntimeTimer(timer);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
};

export const nextTurn = <T>(readValue: () => T): Promise<T> => new Promise((resolve) => {
  scheduleRuntimeTimer(() => resolve(readValue()), 0);
});

export const withTimeout = async (operation: Promise<void>, timeoutMs: number, message: string): Promise<void> => {
  let timeout: RuntimeTimer | null = null;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = scheduleRuntimeTimer(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== null) cancelRuntimeTimer(timeout);
  }
};
