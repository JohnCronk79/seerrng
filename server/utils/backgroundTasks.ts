import logger from '@server/logger';

const pendingBackgroundTasks = new Map<Promise<void>, string>();

export const trackBackgroundTask = (
  name: string,
  task: () => unknown | Promise<unknown>
): void => {
  const tracked = Promise.resolve()
    .then(task)
    .then(() => undefined)
    .catch((error) => {
      logger.error(`Background task failed: ${name}`, {
        label: 'Background Tasks',
        errorMessage:
          error instanceof Error ? error.message : 'Unknown background error',
      });
    })
    .finally(() => {
      pendingBackgroundTasks.delete(tracked);
    });
  pendingBackgroundTasks.set(tracked, name);
};

export const waitForBackgroundTasks = async (): Promise<void> => {
  while (true) {
    if (pendingBackgroundTasks.size > 0) {
      await Promise.all([...pendingBackgroundTasks.keys()]);
      continue;
    }

    // A completing task can defer follow-up work until the next event-loop
    // turn. Require a quiescent turn before declaring the tracker drained.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (pendingBackgroundTasks.size === 0) {
      return;
    }
  }
};

export const getPendingBackgroundTaskCount = (): number =>
  pendingBackgroundTasks.size;
