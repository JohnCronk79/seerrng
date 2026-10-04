import Discover from '@app/components/Discover';
import {
  getInternalApiBaseUrl,
  INTERNAL_API_HTTP_OPTIONS,
} from '@app/utils/internalApi';
import type DiscoverSlider from '@server/entity/DiscoverSlider';
import axios from 'axios';
import type { GetServerSideProps, NextPage } from 'next';

type IndexPageProps = {
  discoverSliders?: DiscoverSlider[];
};

const Index: NextPage<IndexPageProps> = ({ discoverSliders }) => {
  return <Discover initialSliders={discoverSliders} />;
};

export const getServerSideProps: GetServerSideProps<IndexPageProps> = async (
  ctx
) => {
  try {
    const response = await axios.get<DiscoverSlider[]>(
      `${getInternalApiBaseUrl()}/api/v1/settings/discover`,
      {
        ...INTERNAL_API_HTTP_OPTIONS,
        headers: ctx.req?.headers?.cookie
          ? { cookie: ctx.req.headers.cookie }
          : undefined,
      }
    );

    return {
      props: {
        discoverSliders: response.data,
      },
    };
  } catch {
    return {
      props: {},
    };
  }
};

export default Index;
