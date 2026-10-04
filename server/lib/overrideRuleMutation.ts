import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import AsyncLock from '@server/utils/asyncLock';

const overrideRuleMutationLock = new AsyncLock();

export const getOverrideRuleMutationResource = (ruleId: number): string => {
  if (!Number.isSafeInteger(ruleId) || ruleId <= 0) {
    throw new Error('A valid override rule ID is required for a mutation.');
  }
  return `override-rule:${ruleId}`;
};

export const runOverrideRuleMutation = <Result>(
  ruleId: number,
  callback: () => Promise<Result>
): Promise<Result> => {
  const resource = getOverrideRuleMutationResource(ruleId);

  return requestAdmissionCoordinator.run([resource], () =>
    overrideRuleMutationLock.dispatch(resource, callback)
  );
};
