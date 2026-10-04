import { it } from 'node:test';

import { IssueStatus } from '@server/constants/issue';
import Issue from '@server/entity/Issue';
import { IssueSubscriber } from '@server/subscriber/IssueSubscriber';
import type { UpdateEvent } from 'typeorm';

it('ignores partial issue updates without a database snapshot', async () => {
  const event = {
    entity: new Issue({ id: 1, status: IssueStatus.RESOLVED }),
  } as unknown as UpdateEvent<Issue>;

  await new IssueSubscriber().beforeUpdate(event);
});
