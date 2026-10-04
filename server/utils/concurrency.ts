export const mapWithConcurrency = async <Input, Output>(
  items: readonly Input[],
  concurrency: number,
  mapper: (item: Input, index: number) => Promise<Output>
): Promise<Output[]> => {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error('Concurrency must be a positive integer.');
  }

  const results = new Array<Output>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
};

export const settlePromisesWithin = async <Result>(
  promises: readonly Promise<Result>[],
  timeoutMs: number
): Promise<{
  results: PromiseSettledResult<Result>[];
  timedOut: boolean;
}> => {
  const completed = new Map<number, PromiseSettledResult<Result>>();
  const trackedPromises = promises.map((promise, index) =>
    promise.then(
      (value) => {
        completed.set(index, { status: 'fulfilled', value });
      },
      (reason: unknown) => {
        completed.set(index, { status: 'rejected', reason });
      }
    )
  );

  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });

  try {
    await Promise.race([Promise.all(trackedPromises), timeout]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  return {
    results: [...completed.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, result]) => result),
    timedOut,
  };
};

export class BoundedTaskQueueFullError extends Error {
  constructor() {
    super('Task queue capacity has been reached.');
    this.name = 'BoundedTaskQueueFullError';
  }
}

export class BoundedTaskQueue {
  private active = 0;
  private readonly queued: (() => void)[] = [];
  private readonly idleWaiters = new Set<() => void>();

  public constructor(
    private readonly concurrency: number,
    private readonly maxQueued: number
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
      throw new Error('Task queue concurrency must be a positive integer.');
    }
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 0) {
      throw new Error('Task queue capacity must be a non-negative integer.');
    }
  }

  public run<Result>(task: () => Promise<Result>): Promise<Result> {
    if (
      this.active >= this.concurrency &&
      this.queued.length >= this.maxQueued
    ) {
      return Promise.reject(new BoundedTaskQueueFullError());
    }

    return new Promise<Result>((resolve, reject) => {
      const start = (): void => {
        this.active += 1;
        void Promise.resolve()
          .then(task)
          .then(
            (result) => {
              this.finish();
              resolve(result);
            },
            (error) => {
              this.finish();
              reject(error);
            }
          );
      };

      if (this.active < this.concurrency) {
        start();
      } else {
        this.queued.push(start);
      }
    });
  }

  public waitForIdle(): Promise<void> {
    if (this.active === 0 && this.queued.length === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  private finish(): void {
    this.active -= 1;
    this.queued.shift()?.();
    if (this.active === 0 && this.queued.length === 0) {
      for (const resolve of this.idleWaiters) {
        resolve();
      }
      this.idleWaiters.clear();
    }
  }
}
