import { IssueStatus } from '@server/constants/issue';
import Issue from '@server/entity/Issue';
import notificationManager, { Notification } from '@server/lib/notifications';
import type {
  EntitySubscriberInterface,
  InsertEvent,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  UpdateEvent,
} from 'typeorm';
import { EventSubscriber } from 'typeorm';

@EventSubscriber()
export class IssueSubscriber implements EntitySubscriberInterface<Issue> {
  public listenTo(): typeof Issue {
    return Issue;
  }

  public async afterInsert(event: InsertEvent<Issue>): Promise<void> {
    if (!event.entity) {
      return;
    }
    await notificationManager.sendNotificationIntent(
      Notification.ISSUE_CREATED,
      { kind: 'issue', issueId: event.entity.id },
      event.queryRunner
    );
  }

  public async beforeUpdate(event: UpdateEvent<Issue>): Promise<void> {
    if (!event.entity || !event.databaseEntity) {
      return;
    }
    const modifiedById = event.entity.modifiedBy?.id;
    if (
      event.entity.status === IssueStatus.RESOLVED &&
      event.databaseEntity.status !== IssueStatus.RESOLVED
    ) {
      await notificationManager.sendNotificationIntent(
        Notification.ISSUE_RESOLVED,
        { kind: 'issue', issueId: event.entity.id, modifiedById },
        event.queryRunner
      );
    } else if (
      event.entity.status === IssueStatus.OPEN &&
      event.databaseEntity.status !== IssueStatus.OPEN
    ) {
      await notificationManager.sendNotificationIntent(
        Notification.ISSUE_REOPENED,
        { kind: 'issue', issueId: event.entity.id, modifiedById },
        event.queryRunner
      );
    }
  }

  public afterTransactionCommit(event: TransactionCommitEvent): void {
    notificationManager.commitDeferredNotifications(event.queryRunner);
  }

  public afterTransactionRollback(event: TransactionRollbackEvent): void {
    notificationManager.rollbackDeferredNotifications(event.queryRunner);
  }
}
