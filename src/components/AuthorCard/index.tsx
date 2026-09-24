import CachedImage from '@app/components/Common/CachedImage';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { UserCircleIcon } from '@heroicons/react/24/solid';
import type { AuthorResult } from '@server/models/Book';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.AuthorCard', {
  workCount: '{count} works',
});

interface AuthorCardProps {
  author: AuthorResult;
  canExpand?: boolean;
}

const AuthorCard = ({ author, canExpand = false }: AuthorCardProps) => {
  const intl = useIntl();
  const [isHovered, setHovered] = useState(false);
  const size = canExpand ? 'w-full' : 'w-36 sm:w-36 md:w-44';

  return (
    <Link
      href={`/author/${encodeApiPathSegment(author.id)}`}
      prefetch={false}
      className={size}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div
        className={`relative ${size} transform-gpu cursor-pointer rounded-xl text-white shadow ring-1 transition duration-150 ease-in-out ${
          isHovered
            ? 'scale-105 bg-gray-700 ring-blue-400/70'
            : 'scale-100 bg-gray-800 ring-gray-700'
        }`}
      >
        <div style={{ paddingBottom: '150%' }}>
          <div className="absolute inset-0 flex flex-col items-center p-2">
            <div className="relative mt-5 mb-4 flex h-1/2 w-full justify-center">
              {author.posterPath ? (
                <div className="relative h-full w-3/4 overflow-hidden rounded-full ring-1 ring-gray-700">
                  <CachedImage
                    type="book"
                    src={author.posterPath}
                    alt=""
                    fill
                    sizes="(min-width: 768px) 176px, 144px"
                    className="object-cover"
                  />
                </div>
              ) : (
                <UserCircleIcon className="h-full text-gray-500" />
              )}
            </div>
            <div className="w-full truncate text-center font-bold">
              {author.name}
            </div>
            {author.topWork && (
              <div className="mt-1 line-clamp-2 overflow-hidden text-center text-sm text-gray-300">
                {author.topWork}
              </div>
            )}
            {author.workCount !== undefined && (
              <div className="mt-1 text-xs text-gray-400">
                {intl.formatMessage(messages.workCount, {
                  count: intl.formatNumber(author.workCount),
                })}
              </div>
            )}
            <div
              className={`pointer-events-none absolute right-0 bottom-0 left-0 h-12 rounded-b-xl bg-gradient-to-t ${
                isHovered ? 'from-gray-800' : 'from-gray-900'
              }`}
            />
          </div>
        </div>
      </div>
    </Link>
  );
};

export default AuthorCard;
