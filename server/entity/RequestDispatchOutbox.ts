import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { MediaRequest } from './MediaRequest';

@Entity('request_dispatch_outbox')
@Unique('UQ_request_dispatch_outbox_request_id', ['requestId'])
export class RequestDispatchOutbox {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  public requestId: number;

  @OneToOne(() => MediaRequest, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'requestId',
    foreignKeyConstraintName: 'FK_request_dispatch_outbox_request',
  })
  public request: MediaRequest;

  @Column({ type: 'integer', default: 0 })
  public attempts: number;

  @Index('IDX_request_dispatch_outbox_created_at')
  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public lastAttemptAt?: Date | null;

  @Index('IDX_request_dispatch_outbox_next_attempt_at')
  @DbAwareColumn({ type: 'datetime', nullable: true })
  public nextAttemptAt?: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  public claimToken?: string | null;

  @Index('IDX_request_dispatch_outbox_claimed_at')
  @DbAwareColumn({ type: 'datetime', nullable: true })
  public claimedAt?: Date | null;

  constructor(init?: Partial<RequestDispatchOutbox>) {
    Object.assign(this, init);
  }
}
