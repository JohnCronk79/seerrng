import CachedImage from '@app/components/Common/CachedImage';
import { withProperties } from '@app/utils/typeHelpers';
import Link from 'next/link';
import { useState } from 'react';

interface GenreCardProps {
  name: string;
  image: string;
  url: string;
  canExpand?: boolean;
}

const GenreCard = ({ image, url, name, canExpand = false }: GenreCardProps) => {
  const [isHovered, setHovered] = useState(false);

  return (
    <Link
      href={url}
      prefetch={false}
      className={`relative flex h-16 items-center justify-center sm:h-[72px] ${
        canExpand ? 'w-full' : 'w-28 sm:w-36'
      } transform-gpu cursor-pointer p-3 shadow ring-1 transition duration-300 ease-in-out ${
        isHovered
          ? 'scale-105 bg-gray-700/100 ring-gray-500'
          : 'scale-100 bg-gray-800/80 ring-gray-700'
      } overflow-hidden rounded-xl bg-cover bg-center`}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          setHovered(true);
        }
      }}
      role="link"
      tabIndex={0}
    >
      <CachedImage
        type="tmdb"
        src={image}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        fill
      />
      <div
        className={`absolute inset-0 z-10 h-full w-full transition duration-300 ${
          isHovered ? 'bg-gray-800/10' : 'bg-gray-800/30'
        }`}
      />
      <div className="relative z-20 w-full truncate text-center text-base leading-5 font-bold whitespace-normal text-white sm:text-lg">
        {name}
      </div>
    </Link>
  );
};

const GenreCardPlaceholder = () => {
  return (
    <div className="relative h-16 w-28 animate-pulse rounded-xl bg-gray-700 sm:h-[72px] sm:w-36" />
  );
};

export default withProperties(GenreCard, { Placeholder: GenreCardPlaceholder });
