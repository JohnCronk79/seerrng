import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import ThreeItemScroll from '@app/components/Common/ThreeItemScroll';
import type {
  AssociationEdge,
  AssociationMediaType,
} from '@app/hooks/useAssociations';
import useAssociations from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';
import AssociationDetailCard from './AssociationDetailCard';
import AssociationFilters from './AssociationFilters';

const messages = defineMessages('components.Association', {
  similarartists: 'Similar Artists',
  alsoconnected: 'Also Connected',
  similargenres: 'Similar Genres',
  connectedmusic: 'Connected Music',
  empty: 'No associations found yet',
  loaderror: 'Could not load associations.',
});

const AssociationSections = ({
  edges,
  mediaType,
  onSelect,
}: {
  edges: AssociationEdge[];
  mediaType: AssociationMediaType;
  onSelect?: () => void;
}) => {
  const intl = useIntl();
  const sameMedium = edges
    .filter((edge) => edge.type === 'similar' || edge.type === 'recommended')
    .slice(0, 5);
  const connectedEdges = edges.filter(
    (edge) => edge.type === 'shared-person' || edge.type === 'shared-genre'
  );
  const isScreen = mediaType === 'movie' || mediaType === 'tv';
  const connected = isScreen
    ? []
    : mediaType === 'book'
      ? connectedEdges
      : connectedEdges.slice(0, 4);
  const similarGenres = isScreen
    ? connectedEdges.filter((edge) => edge.type === 'shared-genre').slice(0, 4)
    : [];
  const connectedMusic = isScreen
    ? connectedEdges.filter((edge) => edge.type === 'shared-person').slice(0, 4)
    : [];
  if (
    sameMedium.length === 0 &&
    connected.length === 0 &&
    similarGenres.length === 0 &&
    connectedMusic.length === 0
  )
    return (
      <div className="px-3 py-6 text-center text-sm text-gray-400">
        {intl.formatMessage(messages.empty)}
      </div>
    );
  return (
    <>
      {sameMedium.length > 0 && (
        <section className="mb-4">
          {(mediaType === 'album' || mediaType === 'artist') && (
            <h2 className="mb-2 text-xs font-semibold tracking-wider text-gray-200">
              {intl.formatMessage(messages.similarartists)}
            </h2>
          )}
          <ThreeItemScroll label={intl.formatMessage(messages.similarartists)}>
            {sameMedium.map((edge) => (
              <AssociationDetailCard
                key={edge.node.mediaType + ':' + edge.node.id}
                edge={edge}
                onSelect={onSelect}
              />
            ))}
          </ThreeItemScroll>
        </section>
      )}
      {connected.length > 0 && (
        <section>
          <ThreeItemScroll label={intl.formatMessage(messages.alsoconnected)}>
            {connected.map((edge) => (
              <AssociationDetailCard
                key={edge.node.mediaType + ':' + edge.node.id}
                edge={edge}
                onSelect={onSelect}
              />
            ))}
          </ThreeItemScroll>
        </section>
      )}
      {similarGenres.length > 0 && (
        <section>
          <div className="slider-header">
            <h2 className="slider-title">
              {intl.formatMessage(messages.similargenres)}
            </h2>
          </div>
          <ThreeItemScroll label={intl.formatMessage(messages.similargenres)}>
            {similarGenres.map((edge) => (
              <AssociationDetailCard
                key={edge.node.mediaType + ':' + edge.node.id}
                edge={edge}
                onSelect={onSelect}
              />
            ))}
          </ThreeItemScroll>
        </section>
      )}
      {connectedMusic.length > 0 && (
        <section>
          <div className="slider-header">
            <h2 className="slider-title">
              {intl.formatMessage(messages.connectedmusic)}
            </h2>
          </div>
          <ThreeItemScroll label={intl.formatMessage(messages.connectedmusic)}>
            {connectedMusic.map((edge) => (
              <AssociationDetailCard
                key={edge.node.mediaType + ':' + edge.node.id}
                edge={edge}
                onSelect={onSelect}
              />
            ))}
          </ThreeItemScroll>
        </section>
      )}
    </>
  );
};

export default function AssociationPopover({
  mediaType,
  id,
  onSelect,
}: {
  mediaType: AssociationMediaType;
  id: string | number;
  onSelect?: () => void;
}) {
  const intl = useIntl();
  const { edges, isLoading, isError } = useAssociations(mediaType, id, {
    includeWeak: true,
  });
  return (
    <div className="min-w-0">
      {isLoading && <LoadingSpinner />}
      {!isLoading && isError && (
        <div className="px-3 py-6 text-center text-sm text-red-300">
          {intl.formatMessage(messages.loaderror)}
        </div>
      )}
      {!isLoading && !isError && edges.length === 0 && (
        <div className="px-3 py-6 text-center text-sm text-gray-400">
          {intl.formatMessage(messages.empty)}
        </div>
      )}
      {!isLoading && !isError && edges.length > 0 && (
        <AssociationFilters edges={edges} mediaType={mediaType}>
          {(filtered) => (
            <AssociationSections
              edges={filtered}
              mediaType={mediaType}
              onSelect={onSelect}
            />
          )}
        </AssociationFilters>
      )}
    </div>
  );
}
