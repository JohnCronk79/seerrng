// whenever you need to run async code on tv show or movie that does "get existing" / "check if need to create new" / "save"
// then you need to put all of that code in "await asyncLock.dispatch" callback based on media id
// this will guarantee that only one part of code will run at the same for this media id to avoid code
// trying to create two or more entries for same movie/tvshow (which would result in sqlite unique constraint failrue)

class AsyncLock {
  private tails = new Map<string, Promise<void>>();

  public dispatch = async <T>(
    key: string | number,
    callback: () => Promise<T>
  ): Promise<T> => {
    const skey = String(key);
    const previous = this.tails.get(skey) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(skey, current);

    await previous;
    try {
      return await callback();
    } finally {
      release();
      if (this.tails.get(skey) === current) {
        this.tails.delete(skey);
      }
    }
  };
}

export default AsyncLock;
