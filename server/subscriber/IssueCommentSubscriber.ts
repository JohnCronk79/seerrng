import IssueComment from '@server/entity/IssueComment';
import notificationManager, { Notification } from '@server/lib/notifications';
import type {
  EntitySubscriberInterface,
  InsertEvent,
  TransactionCommitEvent,
  TransactionRollbackEvent,
} from 'typeorm';
import { EventSubscriber } from 'typeorm';

@EventSubscriber()
export class IssueCommentSubscriber implements EntitySubscriberInterface<IssueComment> {
  public listenTo(): typeof IssueComment {
    return IssueComment;
  }

  public async afterInsert(event: InsertEvent<IssueComment>): Promise<void> {
    if (!event.entity) {
      return;
    }
    await notificationManager.sendNotificationIntent(
      Notification.ISSUE_COMMENT,
      { kind: 'issue-comment', commentId: event.entity.id },
      event.queryRunner
    );
  }

  public afterTransactionCommit(event: TransactionCommitEvent): void {
    notificationManager.commitDeferredNotifications(event.queryRunner);
  }

  public afterTransactionRollback(event: TransactionRollbackEvent): void {
    notificationManager.rollbackDeferredNotifications(event.queryRunner);
  }
}
