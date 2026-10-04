import { defaultSliders } from '@server/constants/discover';
import { getRepository } from '@server/datasource';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Repository } from 'typeorm';
import DiscoverSlider from './DiscoverSlider';

setupTestDb();

describe('DiscoverSlider bootstrap', () => {
  it('does not ask TypeORM to hydrate IDs for ignored inserts', async () => {
    let updateEntity: boolean | undefined;
    let executed = false;
    const queryBuilder = {
      insert() {
        return this;
      },
      into() {
        return this;
      },
      values() {
        return this;
      },
      orIgnore() {
        return this;
      },
      updateEntity(enabled: boolean) {
        updateEntity = enabled;
        return this;
      },
      async execute() {
        executed = true;
      },
    };
    const repository = {
      createQueryBuilder: () => queryBuilder,
    } as unknown as Repository<DiscoverSlider>;

    await DiscoverSlider.bootstrapSliders(repository);

    assert.equal(updateEntity, false);
    assert.equal(executed, true);
  });

  it('atomically creates one copy of each built-in across concurrent calls', async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => DiscoverSlider.bootstrapSliders())
    );

    const builtIns = await getRepository(DiscoverSlider).find({
      where: { isBuiltIn: true },
    });
    assert.equal(builtIns.length, defaultSliders.length);
    assert.deepEqual(
      [...new Set(builtIns.map((slider) => slider.type))].sort(
        (left, right) => left - right
      ),
      defaultSliders
        .map((slider) => slider.type!)
        .sort((left, right) => left - right)
    );
  });

  it('still permits custom sliders to share a type', async () => {
    const type = defaultSliders[0].type!;
    await getRepository(DiscoverSlider).save([
      new DiscoverSlider({
        type,
        title: 'First custom slider',
        order: 1,
        isBuiltIn: false,
      }),
      new DiscoverSlider({
        type,
        title: 'Second custom slider',
        order: 2,
        isBuiltIn: false,
      }),
    ]);

    assert.equal(
      await getRepository(DiscoverSlider).count({
        where: { type, isBuiltIn: false },
      }),
      2
    );
  });
});
