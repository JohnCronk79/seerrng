import { getSafeHref, isExternalHref } from '@app/utils/safeUrl';
import Link from 'next/link';
import React from 'react';

interface BadgeProps {
  badgeType?:
    'default' | 'primary' | 'danger' | 'warning' | 'success' | 'dark' | 'light';
  className?: string;
  href?: string;
  children: React.ReactNode;
}

const Badge = (
  { badgeType = 'default', className, href, children }: BadgeProps,
  ref?: React.Ref<HTMLElement>
) => {
  const badgeStyle =
    `app-badge app-badge-${badgeType} ${href ? 'app-badge-link' : 'app-badge-static'} ${className ?? ''}`.trim();

  const safeHref = getSafeHref(href);

  if (safeHref && isExternalHref(safeHref)) {
    return (
      <a
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer"
        className={badgeStyle}
        ref={ref as React.Ref<HTMLAnchorElement>}
      >
        {children}
      </a>
    );
  } else if (safeHref) {
    return (
      <Link
        href={safeHref}
        className={badgeStyle}
        ref={ref as React.Ref<HTMLAnchorElement>}
      >
        {children}
      </Link>
    );
  } else {
    return (
      <span className={badgeStyle} ref={ref as React.Ref<HTMLSpanElement>}>
        {children}
      </span>
    );
  }
};

export default React.forwardRef(Badge) as typeof Badge;
