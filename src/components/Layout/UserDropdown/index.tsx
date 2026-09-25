import CachedImage from '@app/components/Common/CachedImage';
import MiniQuotaDisplay from '@app/components/Layout/UserDropdown/MiniQuotaDisplay';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { Menu } from '@headlessui/react';
import {
  ArrowRightOnRectangleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { CogIcon, UserIcon } from '@heroicons/react/24/solid';
import axios from 'axios';
import type { LinkProps } from 'next/link';
import Link from 'next/link';
import { forwardRef } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Layout.UserDropdown', {
  myprofile: 'Profile',
  settings: 'Settings',
  requests: 'Requests',
  signout: 'Sign Out',
});

const ForwardedLink = forwardRef<
  HTMLAnchorElement,
  LinkProps & React.ComponentPropsWithoutRef<'a'>
>(({ href, children, ...rest }, ref) => {
  return (
    <Link href={href} ref={ref} {...rest}>
      {children}
    </Link>
  );
});

ForwardedLink.displayName = 'ForwardedLink';

const UserDropdown = () => {
  const intl = useIntl();
  const { user, revalidate } = useUser();

  const logout = async () => {
    const response = await axios.post('/api/v1/auth/logout');

    if (response.data?.status === 'ok') {
      revalidate();
    }
  };

  return (
    <Menu as="div" className="relative">
      <div>
        <Menu.Button
          className="flex max-w-xs items-center rounded-full text-sm ring-1 ring-gray-700 hover:ring-gray-500 focus:ring-gray-500 focus:outline-none"
          data-testid="user-menu"
          aria-label="User menu"
        >
          <CachedImage
            type="avatar"
            className="h-8 w-8 rounded-full object-cover sm:h-10 sm:w-10"
            src={user ? user.avatar : ''}
            alt=""
            width={40}
            height={40}
          />
        </Menu.Button>
      </div>
      <Menu.Items
        transition
        className="absolute right-0 z-50 mt-2 w-72 origin-top-right rounded-md shadow-lg transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0"
      >
        <div className="app-user-menu-surface divide-y divide-gray-700 rounded-md ring-1 ring-gray-700 backdrop-blur">
          <div className="flex flex-col space-y-4 px-4 py-4">
            <div className="flex items-center space-x-2">
              <CachedImage
                type="avatar"
                className="h-8 w-8 rounded-full object-cover sm:h-10 sm:w-10"
                src={user ? user.avatar : ''}
                alt=""
                width={40}
                height={40}
              />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-xl font-semibold text-gray-200">
                  {user?.displayName}
                </span>
                {user?.displayName?.toLowerCase() !== user?.email && (
                  <span className="truncate text-sm text-gray-400">
                    {user?.email}
                  </span>
                )}
              </div>
            </div>
            {user && <MiniQuotaDisplay userId={user?.id} />}
          </div>
          <div className="p-1">
            <Menu.Item>
              {({ active }) => (
                <ForwardedLink
                  href={`/profile`}
                  className={`flex items-center rounded px-4 py-2 text-sm font-medium text-gray-200 transition duration-150 ease-in-out ${
                    active
                      ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
                      : ''
                  }`}
                  data-testid="user-menu-profile"
                >
                  <UserIcon className="mr-2 inline h-5 w-5" />
                  <span>{intl.formatMessage(messages.myprofile)}</span>
                </ForwardedLink>
              )}
            </Menu.Item>
            <Menu.Item>
              {({ active }) => (
                <ForwardedLink
                  href="/requests/status"
                  className={`flex items-center rounded px-4 py-2 text-sm font-medium text-gray-200 transition duration-150 ease-in-out ${
                    active
                      ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
                      : ''
                  }`}
                  data-testid="user-menu-settings"
                >
                  <ClockIcon className="mr-2 inline h-5 w-5" />
                  <span>{intl.formatMessage(messages.requests)}</span>
                </ForwardedLink>
              )}
            </Menu.Item>
            <Menu.Item>
              {({ active }) => (
                <ForwardedLink
                  href={`/profile/settings`}
                  className={`flex items-center rounded px-4 py-2 text-sm font-medium text-gray-200 transition duration-150 ease-in-out ${
                    active
                      ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
                      : ''
                  }`}
                  data-testid="user-menu-settings"
                >
                  <CogIcon className="mr-2 inline h-5 w-5" />
                  <span>{intl.formatMessage(messages.settings)}</span>
                </ForwardedLink>
              )}
            </Menu.Item>
            <Menu.Item>
              {({ active }) => (
                <a
                  href="#"
                  className={`flex items-center rounded px-4 py-2 text-sm font-medium text-gray-200 transition duration-150 ease-in-out ${
                    active
                      ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
                      : ''
                  }`}
                  onClick={() => logout()}
                >
                  <ArrowRightOnRectangleIcon className="mr-2 inline h-5 w-5" />
                  <span>{intl.formatMessage(messages.signout)}</span>
                </a>
              )}
            </Menu.Item>
          </div>
        </div>
      </Menu.Items>
    </Menu>
  );
};

export default UserDropdown;
