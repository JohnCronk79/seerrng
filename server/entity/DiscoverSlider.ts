import type { DiscoverSliderType } from '@server/constants/discover';
import { defaultSliders } from '@server/constants/discover';
import { getRepository } from '@server/datasource';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import type { Repository } from 'typeorm';
import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
@Index('UQ_discover_slider_builtin_type', ['type'], {
  unique: true,
  where: '"isBuiltIn" = true',
})
class DiscoverSlider {
  public static async bootstrapSliders(
    repository: Repository<DiscoverSlider> = getRepository(DiscoverSlider)
  ): Promise<void> {
    await repository
      .createQueryBuilder()
      .insert()
      .into(DiscoverSlider)
      .values(defaultSliders)
      .orIgnore()
      // PostgreSQL returns no row for values skipped by ON CONFLICT DO
      // NOTHING. TypeORM otherwise tries to copy generated IDs from those
      // missing rows back into every input entity and aborts startup.
      .updateEntity(false)
      .execute();
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'int' })
  public type: DiscoverSliderType;

  @Column({ type: 'int' })
  public order: number;

  @Column({ default: false })
  public isBuiltIn: boolean;

  @Column({ default: true })
  public enabled: boolean;

  @Column({ nullable: true })
  // Title is not required for built in sliders because we will
  // use translations for them.
  public title?: string;

  @Column({ nullable: true })
  public data?: string;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<DiscoverSlider>) {
    Object.assign(this, init);
  }
}

export default DiscoverSlider;
