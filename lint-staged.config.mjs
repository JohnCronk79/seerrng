export default {
  '**/*.{ts,tsx,js}': ['prettier --write', 'eslint'],
  '**/*.{json,md,css}': ['prettier --write'],
};
