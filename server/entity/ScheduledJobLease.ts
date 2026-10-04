import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('scheduled_job_lease')
export class ScheduledJobLease {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  public name: string;

  @Column({ type: 'varchar', length: 64 })
  public owner: string;

  @Index('IDX_scheduled_job_lease_expires_at')
  @DbAwareColumn({ type: 'datetime' })
  public expiresAt: Date;

  constructor(init?: Partial<ScheduledJobLease>) {
    Object.assign(this, init);
  }
}
