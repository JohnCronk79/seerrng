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
