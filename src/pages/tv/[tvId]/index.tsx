import TvDetails from '@app/components/TvDetails';
import {
  encodeInternalApiPathSegment,
  getInternalApiBaseUrl,
  INTERNAL_API_HTTP_OPTIONS,
} from '@app/utils/internalApi';
import type { TvDetails as TvDetailsType } from '@server/models/Tv';
import axios from 'axios';
import type { GetServerSideProps, NextPage } from 'next';

interface TvPageProps {
  tv?: TvDetailsType;
}

const TvPage: NextPage<TvPageProps> = ({ tv }) => {
  return <TvDetails tv={tv} />;
};

export const getServerSideProps: GetServerSideProps<TvPageProps> = async (
  ctx
) => {
  const response = await axios.get<TvDetailsType>(
    `${getInternalApiBaseUrl()}/api/v1/tv/${encodeInternalApiPathSegment(
      ctx.query.tvId
    )}`,
    {
      ...INTERNAL_API_HTTP_OPTIONS,
      headers: ctx.req?.headers?.cookie
        ? { cookie: ctx.req.headers.cookie }
        : undefined,
    }
  );

  return {
    props: {
      tv: response.data,
    },
  };
};

export default TvPage;
