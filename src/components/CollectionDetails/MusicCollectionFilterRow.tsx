import {
  CompactSelect,
  getFilterResetButtonClass,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import MusicReleaseTypeSelect from '@app/components/Discover/FilterPanel/MusicReleaseTypeSelect';
import defineMessages from '@app/utils/defineMessages';
import {
  EMPTY_MUSIC_COLLECTION_FILTERS,
  musicCollectionFilterOptions,
  type MusicCollectionFilters,
} from '@app/utils/musicCollectionFilters';
import type { CuratedCollectionMember } from '@server/models/CuratedCollection';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MusicCollectionFilters', {
  clear: 'Clear Filters',
  genre: 'Genres',
  year: 'Release Year',
  any: 'Any',
  unknown: 'Unknown',
  label: 'Collection filters',
});
export default function MusicCollectionFilterRow({
  parts,
  filters,
  onChange,
}: {
  parts: CuratedCollectionMember[];
  filters: MusicCollectionFilters;
  onChange: (filters: MusicCollectionFilters) => void;
}) {
  const intl = useIntl();
  const options = musicCollectionFilterOptions(parts);
  const any = { value: '', label: intl.formatMessage(messages.any) };
  const inactive = !Object.values(filters).some(Boolean);
  return (
    <div
      className="music-collection-filter-row"
      role="group"
      aria-label={intl.formatMessage(messages.label)}
    >
      <button
        type="button"
        className={getFilterResetButtonClass(inactive)}
        aria-pressed={inactive}
        onClick={() => onChange({ ...EMPTY_MUSIC_COLLECTION_FILTERS })}
      >
        {intl.formatMessage(messages.clear)}
      </button>
      <MusicReleaseTypeSelect
        value={filters.releaseType}
        onChange={(releaseType) => onChange({ ...filters, releaseType })}
      />
      <CompactSelect
        label={intl.formatMessage(messages.genre)}
        value={filters.genre}
        options={[any, ...options.genres]}
        onChange={(genre) => onChange({ ...filters, genre })}
      />
      <CompactSelect
        label={intl.formatMessage(messages.year)}
        value={filters.year}
        options={[
          any,
          ...options.years,
          ...(options.unknownYear
            ? [
                {
                  value: 'unknown',
                  label: intl.formatMessage(messages.unknown),
                },
              ]
            : []),
        ]}
        onChange={(year) => onChange({ ...filters, year })}
      />
    </div>
  );
}
