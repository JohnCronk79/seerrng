import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('issue navigation shares the same green color rule as Previous and Next controls', () => {
  const css = read('../../styles/globals.css');
  assert.match(css, /\.app-button-success,\s*\.issue-view-action\s*\{\s*@apply border-green-500/);
  assert.match(read('./ManageMediaActions.tsx'), /buttonType="success"\s*disabled=\{!canViewIssues/);
  assert.match(read('../Slider/index.tsx'), /buttonType="success"/);
});
test('Manage uses yellow for closing issues and red for destructive confirmations', () => {
  const source = read('./ManageMediaActions.tsx');
  assert.match(source, /buttonType="warning"[\s\S]*?messages.closeDescription/);
  assert.match(source, /buttonType="danger"[\s\S]*?messages.deleteDescription/);
  assert.match(source, /action === 'closeIssues' \? 'warning' : 'danger'/);
  assert.match(
    source,
    /disabled=\{busy \|\| !!libraryError \|\| !targets.length\}/
  );
});

test('library deletion shares red styling and disabled Manage issue actions keep semantic colors', () => {
  const css = read('../../styles/globals.css');
  assert.match(
    css,
    /\.app-button-danger,\s*\.request-destructive-action-delete,\s*\.request-destructive-action-remove\s*\{\s*@apply border-red-500/
  );
  assert.match(
    css,
    /\.manage-request-actions \.app-button-danger:disabled,\s*\.manage-request-actions \.app-button-warning:disabled\s*\{\s*filter: none !important;/
  );
  const action = read('../RequestStatus/destructiveActions.tsx');
  assert.match(action, /remove: 'Delete From Library'/);
  assert.match(action, /disabled=\{disabled \|\| busy\}/);
});

for (const file of [
  './index.tsx',
  '../ExternalMediaManageSlideOver/index.tsx',
]) {
  test(`${file} has only shared destructive actions and no forced availability`, () => {
    const source = read(file);
    assert.match(source, /<ManageMediaActions/);
    assert.doesNotMatch(
      source,
      /markAvailable|deleteMediaFile|deleteMedia\s*=|ConfirmButton|manageModalClearMedia|\/available/
    );
    assert.match(read('./ManageMediaActions.tsx'), /buttonType="warning"/);
    assert.match(source, /hideIssueAction/);
    assert.doesNotMatch(source, /manageModalAdvanced/);
    assert.match(source, /hideDeleteAction/);
    assert.match(source, /backgroundClickable=\{!confirmationOpen\}/);
    assert.match(source, /onDialogChange=\{setConfirmationOpen\}/);
    assert.match(source, /contentClass="manage-dialog-content"/);
    assert.match(source, /<IssueItem[\s\S]*?embedded/);
  });
}
test('global Manage spacing separates 8px padding from gaps and the issue action is not clipped', () => {
  const css = read('../../styles/globals.css');
  assert.match(css, /--card-spacing: 8px/);
  assert.match(css, /padding: var\(--main-card-padding\) !important/);
  assert.match(css, /gap: var\(--card-spacing\)/);
  assert.match(css, /\.issue-action-value\s*\{[^}]*overflow: visible/s);
});

test('Manage buttons no longer show a red issue dot for any media type', () => {
  for (const type of ['Movie', 'Tv', 'Book', 'Music']) {
    assert.doesNotMatch(read(`../${type}Details/index.tsx`), /animate-ping/);
  }
});
test('request screen consumes the same buttons, confirmations and destructive endpoints', () => {
  const source = read('../RequestStatus/index.tsx');
  assert.match(source, /<RequestActionButton/);
  assert.match(source, /<RequestActionConfirmation/);
  assert.match(source, /await deleteRequestStatus\(requestId\)/);
  assert.match(source, /await deleteLibraryMedia\(selection\)/);
});
