/* eslint-disable @typescript-eslint/no-require-imports -- Shared CommonJS validator used by the repository scripts and Node tests. */
const ts = require('typescript');

const REFRESHED_STYLE_MARKERS = [
  'refreshed-card-surface',
  'refreshed-inset-surface',
  'refreshed-detail-text',
  'refreshed-artwork-scrim',
  'availability-quality-control',
  'media-primary-action-row',
  'selection-circle',
  'title-card-overlay-',
];

const ALWAYS_SCOPED_PREFIXES = ['src/components/TitleCard/'];
const CONTAINER_TAGS = new Set([
  'article',
  'aside',
  'div',
  'dl',
  'li',
  'main',
  'section',
]);

const isScopedFile = (fileName, source) =>
  ALWAYS_SCOPED_PREFIXES.some((prefix) => fileName.startsWith(prefix)) ||
  REFRESHED_STYLE_MARKERS.some((marker) => source.includes(marker));

const getAttribute = (opening, name) =>
  opening.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) && property.name.getText() === name
  );

const getAttributeText = (attribute, sourceFile) => {
  if (!attribute?.initializer) return '';
  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text;
  }
  if (ts.isJsxExpression(attribute.initializer)) {
    return attribute.initializer.expression?.getText(sourceFile) ?? '';
  }
  return attribute.initializer.getText(sourceFile);
};

const hasDirectMutedGrayText = (classText) =>
  /(?:^|[\s'"`])text-gray-(?:400|500)(?=$|[\s'"`}])/.test(classText);

const hasNeutralCardSurface = (tagName, classText) =>
  CONTAINER_TAGS.has(tagName) &&
  /(?:^|[\s'"`])rounded-(?:lg|xl)(?=$|[\s'"`}])/.test(classText) &&
  /(?:^|[\s'"`])border(?:-[^\s'"`}]+)?(?=$|[\s'"`}])/.test(classText) &&
  /(?:^|[\s'"`])bg-(?:black|gray-(?:800|900|950))(?:\/[^\s'"`}]+)?(?=$|[\s'"`}])/.test(
    classText
  );

const hasVisualInlineProperty = (styleText) =>
  /\b(?:background|backgroundColor|backgroundImage|borderColor|boxShadow|color|filter|opacity|textShadow|backdropFilter)\s*:/.test(
    styleText
  );

const validateGlobalStylesheet = (fileName, source) => {
  const errors = [];
  const disclosureRule = source.match(
    /\.detail-disclosure-button\s*\{([\s\S]*?)\}/
  );

  if (!disclosureRule) {
    return [`${fileName}:1: shared detail disclosure button rule is required`];
  }

  const line = source.slice(0, disclosureRule.index).split('\n').length;
  const declaration = disclosureRule[1];
  if (/\bbg-(?:black|gray-(?:800|900|950))\b/.test(declaration)) {
    errors.push(
      `${fileName}:${line}: detail disclosure buttons may not use a near-black surface`
    );
  }
  if (
    !declaration.includes('var(--theme-control-surface)') ||
    !declaration.includes('var(--theme-control-border)') ||
    !declaration.includes('var(--theme-control-text)')
  ) {
    errors.push(
      `${fileName}:${line}: detail disclosure buttons must use the shared blue control palette`
    );
  }

  return errors;
};

const validateRefreshedUiStyleBoundaries = (files) => {
  const errors = [];
  let scopedFileCount = 0;

  for (const [fileName, source] of Object.entries(files)) {
    if (fileName === 'src/styles/globals.css') {
      errors.push(...validateGlobalStylesheet(fileName, source));
      continue;
    }
    if (!isScopedFile(fileName, source)) continue;
    scopedFileCount += 1;

    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const seen = new Set();
    const report = (node, message) => {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const key = `${line}:${message}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push(`${fileName}:${line}: ${message}`);
      }
    };

    const visit = (node, insideSharedSurface = false) => {
      let nextInsideSharedSurface = insideSharedSurface;

      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const tagName = opening.tagName.getText(sourceFile);
        const classText = getAttributeText(
          getAttribute(opening, 'className'),
          sourceFile
        );
        const ownsSharedSurface =
          classText.includes('refreshed-card-surface') ||
          classText.includes('refreshed-inset-surface');
        nextInsideSharedSurface = insideSharedSurface || ownsSharedSurface;

        if (tagName === 'style') {
          report(
            opening,
            'embedded style blocks are not allowed in refreshed UI'
          );
        }

        const styleAttribute = getAttribute(opening, 'style');
        if (
          styleAttribute &&
          hasVisualInlineProperty(getAttributeText(styleAttribute, sourceFile))
        ) {
          report(
            styleAttribute,
            'visual inline styles must be moved to the shared global stylesheet'
          );
        }

        if (nextInsideSharedSurface && hasDirectMutedGrayText(classText)) {
          report(
            opening,
            'neutral gray card text must use refreshed-detail-text or refreshed-detail-text-muted'
          );
        }

        if (
          nextInsideSharedSurface &&
          hasNeutralCardSurface(tagName, classText) &&
          !ownsSharedSurface
        ) {
          report(
            opening,
            'nested card surfaces must use refreshed-card-surface or refreshed-inset-surface'
          );
        }
      }

      node.forEachChild((child) => visit(child, nextInsideSharedSurface));
    };

    visit(sourceFile);
  }

  return { errors, scopedFileCount };
};

module.exports = {
  isScopedFile,
  validateRefreshedUiStyleBoundaries,
};
