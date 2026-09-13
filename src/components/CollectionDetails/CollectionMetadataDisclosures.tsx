import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import DetailDisclosureButton from '@app/components/MediaDetails/DetailDisclosureButton';
import ExpandableCreditList, {
  type ExpandableCredit,
} from '@app/components/MediaDetails/ExpandableCreditList';
import { mapWithConcurrency } from '@app/utils/concurrency';
import defineMessages from '@app/utils/defineMessages';
import type { MovieDetails } from '@server/models/Movie';
import type { MovieResult } from '@server/models/Search';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.CollectionDetails.Metadata', {
  viewCast: 'View Cast',
  viewCrew: 'View Crew',
  subjectTags: 'Subject Tags',
  fullCastList: 'Full Cast List',
  fullCrewList: 'Full Crew List',
  noCast: 'No cast information available',
  noCrew: 'No crew information available',
  noTags: 'No subject tags available',
});

const tones = [
  'border-indigo-400/80 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/35',
  'border-purple-400/80 bg-purple-500/20 text-purple-100 hover:bg-purple-500/35',
  'border-emerald-400/80 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/35',
  'border-amber-400/80 bg-amber-500/20 text-amber-100 hover:bg-amber-500/35',
  'border-sky-400/80 bg-sky-500/20 text-sky-100 hover:bg-sky-500/35',
] as const;

const CollectionMetadataDisclosures = ({ parts }: { parts: MovieResult[] }) => {
  const intl = useIntl();
  const [open, setOpen] = useState<'cast' | 'crew' | 'tags'>();
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<MovieDetails[]>();

  const toggle = async (section: 'cast' | 'crew' | 'tags') => {
    setOpen((current) => (current === section ? undefined : section));
    if (details || loading) return;
    setLoading(true);
    const loaded = await mapWithConcurrency(parts, 5, async (part) => {
      try {
        return (await axios.get<MovieDetails>(`/api/v1/movie/${part.id}`)).data;
      } catch {
        return undefined;
      }
    });
    setDetails(loaded.filter((item): item is MovieDetails => !!item));
    setLoading(false);
  };
  const uniqueCredits = (type: 'cast' | 'crew'): ExpandableCredit[] => {
    const unique = new Map<number, ExpandableCredit>();
    details?.forEach((movie) => {
      const credits =
        type === 'cast'
          ? movie.credits.cast.map((credit) => ({
              ...credit,
              role: credit.character,
            }))
          : movie.credits.crew.map((credit) => ({
              ...credit,
              role: credit.job,
            }));
      credits.forEach((credit) => {
        if (!unique.has(credit.id)) {
          unique.set(credit.id, {
            id: credit.id,
            name: credit.name,
            role: credit.role,
            profilePath: credit.profilePath,
          });
        }
      });
    });
    return [...unique.values()];
  };
  const keywords = new Map<number, string>();
  details?.forEach((movie) =>
    movie.keywords.forEach((keyword) => keywords.set(keyword.id, keyword.name))
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <DetailDisclosureButton
          label={intl.formatMessage(messages.viewCast)}
          open={open === 'cast'}
          onClick={() => void toggle('cast')}
        />
        <DetailDisclosureButton
          label={intl.formatMessage(messages.viewCrew)}
          open={open === 'crew'}
          onClick={() => void toggle('crew')}
        />
        <DetailDisclosureButton
          label={intl.formatMessage(messages.subjectTags)}
          open={open === 'tags'}
          onClick={() => void toggle('tags')}
        />
      </div>
      {open && loading && (
        <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-6">
          <LoadingSpinner />
        </section>
      )}
      {open === 'cast' && !loading && (
        <ExpandableCreditList
          title={intl.formatMessage(messages.fullCastList)}
          credits={uniqueCredits('cast')}
          emptyLabel={intl.formatMessage(messages.noCast)}
        />
      )}
      {open === 'crew' && !loading && (
        <ExpandableCreditList
          title={intl.formatMessage(messages.fullCrewList)}
          credits={uniqueCredits('crew')}
          emptyLabel={intl.formatMessage(messages.noCrew)}
        />
      )}
      {open === 'tags' && !loading && (
        <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
          <h2 className="mb-2 text-xs font-semibold text-gray-200">
            {intl.formatMessage(messages.subjectTags)}
          </h2>
          {keywords.size === 0 ? (
            <p className="refreshed-detail-text-muted text-xs">
              {intl.formatMessage(messages.noTags)}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {[...keywords].map(([id, name], index) => (
                <Link
                  key={id}
                  href={`/discover/movies/keyword?keywords=${id}`}
                  className={`inline-flex h-[22px] items-center rounded-full border px-2 text-[11px] font-medium transition ${tones[index % tones.length]}`}
                >
                  {name}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
};

export default CollectionMetadataDisclosures;
