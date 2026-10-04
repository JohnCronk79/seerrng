/**
 * Creates a compact deterministic key for in-memory coordination and
 * change-detection. This is deliberately not a password or integrity hash.
 */
export const createDeterministicKey = (value: string): string => {
  let first = 2166136261;
  let second = 2246822519;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }

  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
};
