import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import type {
  AssociationEdge,
  AssociationMediaType,
} from '@app/hooks/useAssociations';
import useAssociations from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import { nodeHref, nodeImage, nodeImageType, nodeTitle } from './helpers';

const messages = defineMessages('components.Association', {
  similar: 'More like this',
  similarartists: 'Similar artists',
  alsoconnected: 'Also connected',
  empty: 'No associations found yet',
  loaderror: 'Could not load associations.',
});

interface AssociationPopoverProps {
  mediaType: AssociationMediaType;
  id: string | number;
}

const EdgeRow = ({ edge }: { edge: AssociationEdge }) => {
  const image = nodeImage(edge.node);
  return (
    <Link
      href={nodeHref(edge.node)}
      className="refreshed-inset-surface grid min-h-[80px] grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-lg border border-gray-700 p-2 transition hover:border-cyan-400 hover:text-white"
    >
      <div className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded bg-gray-800 ring-1 ring-gray-600">
        {image && (
          <CachedImage
            type={nodeImageType(edge.node)}
            src={image}
            alt=""
            fill
            style={{ objectFit: 'cover' }}
          />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white">
          {nodeTitle(edge.node)}
        </div>
        <div className="refreshed-detail-text-muted mt-1 line-clamp-2 text-xs">
          {edge.reason}
        </div>
      </div>
    </Link>
  );
};

const AssociationPopover = ({ mediaType, id }: AssociationPopoverProps) => {
  const intl = useIntl();
  const { edges, isLoading, isError } = useAssociations(mediaType, id, {
    includeWeak: true,
  });
  const similarLabel =
    mediaType === 'album' || mediaType === 'artist'
      ? intl.formatMessage(messages.similarartists)
      : intl.formatMessage(messages.similar);

  const sameMedium = edges
    .filter((e) => e.type === 'similar' || e.type === 'recommended')
    .slice(0, 5);
  const connected = edges
    .filter((e) => e.type === 'shared-person' || e.type === 'shared-genre')
    .slice(0, 4);

  return (
    <div className="max-h-[min(60vh,32rem)] overflow-y-auto pr-1">
      {isLoading && (
        <div className="space-y-2 px-2 py-3">
          <div className="mb-3 flex justify-center">
            <LoadingSpinner />
          </div>
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex items-center gap-3">
              <div className="h-12 w-9 flex-shrink-0 animate-pulse rounded bg-gray-700" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-gray-700" />
                <div className="h-2.5 w-1/2 animate-pulse rounded bg-gray-700" />
              </div>
            </div>
          ))}
        </div>
      )}

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

      {sameMedium.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wider text-gray-200 uppercase">
            {similarLabel}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sameMedium.map((edge) => (
              <EdgeRow
                key={`${edge.node.mediaType}:${edge.node.id}`}
                edge={edge}
              />
            ))}
          </div>
        </section>
      )}

      {connected.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wider text-gray-200 uppercase">
            {intl.formatMessage(messages.alsoconnected)}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {connected.map((edge) => (
              <EdgeRow
                key={`${edge.node.mediaType}:${edge.node.id}`}
                edge={edge}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default AssociationPopover;
