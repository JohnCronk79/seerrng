import type { GetServerSideProps, NextPage } from 'next';

const RequestsPage: NextPage = () => {
  return null;
};

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/requests/status',
    permanent: false,
  },
});

export default RequestsPage;
