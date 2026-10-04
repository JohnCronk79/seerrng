import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  getOverrideRuleMutationResource,
  runOverrideRuleMutation,
} from './overrideRuleMutation';
import requestAdmissionCoordinator from './requestAdmission';

describe('runOverrideRuleMutation', () => {
  it('admits the rule resource across instances', async () => {
    const run = mock.method(
      requestAdmissionCoordinator,
      'run',
      async (_resources: string[], callback: () => Promise<string>) =>
        callback()
    );

    const result = await runOverrideRuleMutation(7, async () => 'ok');

    assert.strictEqual(result, 'ok');
    assert.deepStrictEqual(run.mock.calls[0].arguments[0], [
      getOverrideRuleMutationResource(7),
    ]);
    run.mock.restore();
  });

  it('serializes same-rule mutations locally', async () => {
    const events: string[] = [];
    let firstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const releaseFirstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runOverrideRuleMutation(5, async () => {
      events.push('first-start');
      firstStarted();
      await releaseFirstPromise;
      events.push('first-end');
    });
    await firstStartedPromise;
    const second = runOverrideRuleMutation(5, async () => {
      events.push('second');
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepStrictEqual(events, ['first-start']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepStrictEqual(events, ['first-start', 'first-end', 'second']);
  });

  it('rejects invalid rule IDs', () => {
    for (const ruleId of [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => runOverrideRuleMutation(ruleId, async () => undefined),
        /valid override rule ID/
      );
    }
  });
});
