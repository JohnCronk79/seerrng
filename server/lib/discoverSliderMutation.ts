import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import AsyncLock from '@server/utils/asyncLock';

const DISCOVER_SLIDER_MUTATION_RESOURCE = 'discover-slider:collection';
const discoverSliderMutationLock = new AsyncLock();

export const runDiscoverSliderMutation = <Result>(
  callback: () => Promise<Result>
): Promise<Result> =>
  requestAdmissionCoordinator.run([DISCOVER_SLIDER_MUTATION_RESOURCE], () =>
    discoverSliderMutationLock.dispatch(
      DISCOVER_SLIDER_MUTATION_RESOURCE,
      callback
    )
  );
