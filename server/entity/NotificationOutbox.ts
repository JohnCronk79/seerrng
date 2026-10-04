import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notification_outbox')
export class NotificationOutbox {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  public type: number;

  @Column({ type: 'text' })
  public payload: string;

  @Column({ type: 'simple-json' })
  public targetAgents: string[];

  @Column({ type: 'simple-json' })
  public deliveredAgents: string[];

  @Column({ type: 'integer', default: 0 })
  public attempts: number;

  @Index('IDX_notification_outbox_created_at')
  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public lastAttemptAt?: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  public claimToken?: string | null;

  @Index('IDX_notification_outbox_claimed_at')
  @DbAwareColumn({ type: 'datetime', nullable: true })
  public claimedAt?: Date | null;

  constructor(init?: Partial<NotificationOutbox>) {
    Object.assign(this, init);
  }
}
