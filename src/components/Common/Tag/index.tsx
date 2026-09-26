import { TagIcon } from '@heroicons/react/24/outline';
import React, { memo, useMemo, type JSX } from 'react';

type TagProps = {
  children: React.ReactNode;
  iconSvg?: JSX.Element;
};

const Tag = memo(({ children, iconSvg }: TagProps) => {
  const icon = useMemo(
    () =>
      iconSvg ? (
        React.cloneElement(iconSvg, {
          className: 'mr-1 h-4 w-4',
        })
      ) : (
        <TagIcon className="mr-1 h-4 w-4" />
      ),
    [iconSvg]
  );

  return (
    <div className="app-tag">
      {icon}
      <span>{children}</span>
    </div>
  );
});

Tag.displayName = 'Tag';

export default Tag;
