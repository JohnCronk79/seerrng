const getLocaleDifferences = (originalText, extractedText) => {
  const original = JSON.parse(originalText);
  const extracted = JSON.parse(extractedText);
  const keys = [
    ...new Set([...Object.keys(original), ...Object.keys(extracted)]),
  ]
    .sort()
    .filter((key) => original[key] !== extracted[key]);

  return keys.map((key) => ({
    key,
    original: original[key],
    extracted: extracted[key],
  }));
};

module.exports = { getLocaleDifferences };
