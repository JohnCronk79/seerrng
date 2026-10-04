import useSettings from '@app/hooks/useSettings';
import Head from 'next/head';
import { useMemo } from 'react';

interface PageTitleProps {
  title: string | (string | undefined)[];
}

const PageTitle = ({ title }: PageTitleProps) => {
  const settings = useSettings();

  const titleText = useMemo(
    () =>
      `${
        Array.isArray(title) ? title.filter(Boolean).join(' - ') : title
      } - ${settings.currentSettings.applicationTitle}`,
    [settings.currentSettings.applicationTitle, title]
  );

  return (
    <Head>
      <title>{titleText}</title>
    </Head>
  );
};

export default PageTitle;
