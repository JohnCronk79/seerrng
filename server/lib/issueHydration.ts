import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import { In } from 'typeorm';

export const hydrateIssueRelations = async (
  issues: Issue[]
): Promise<Issue[]> => {
  const ids = [...new Set(issues.map((issue) => issue.id))].filter(
    (id) => Number.isSafeInteger(id) && id > 0
  );
  if (!ids.length) {
    return issues;
  }

  const hydrated = await getRepository(Issue).find({
    where: { id: In(ids) },
    relations: {
      createdBy: true,
      modifiedBy: true,
      comments: { user: true },
      media: { identifiers: true },
    },
    // Comments and media identifiers are independent one-to-many relations.
    relationLoadStrategy: 'query',
  });
  const hydratedById = new Map(hydrated.map((issue) => [issue.id, issue]));

  return issues.map((issue) => hydratedById.get(issue.id) ?? issue);
};
