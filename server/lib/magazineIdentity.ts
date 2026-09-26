export const normalizeMagazineTitle = (title: string): string =>
  title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export const cleanMagazineTitle = (title: string): string =>
  title.normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 256);
