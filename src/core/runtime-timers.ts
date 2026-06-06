/** Timer helper for non-request-path runtime scheduling and cleanup bounds. */

export const delay = (durationMs: number): Promise<void> => new Promise((resolveDelay) => {
  setTimeout(resolveDelay, durationMs);
});

export const nextTurn = <T>(readValue: () => T): Promise<T> => new Promise((resolve) => {
  setTimeout(() => resolve(readValue()), 0);
});

export const withTimeout = async (operation: Promise<void>, timeoutMs: number, message: string): Promise<void> => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
};
