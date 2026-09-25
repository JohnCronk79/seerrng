import { withProperties } from '@app/utils/typeHelpers';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import {
  useRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
} from 'react';

type DropdownButtonType =
  'primary' | 'ghost' | 'success' | 'detailRequest' | 'playback';

interface DropdownItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  buttonType?: DropdownButtonType;
}

const DropdownItem = ({
  children,
  buttonType = 'primary',
  ...props
}: DropdownItemProps) => {
  return (
    <MenuItem>
      <a
        className={[
          'button-md flex cursor-pointer items-center rounded px-4 py-2 text-sm leading-5 focus:text-white focus:outline-none',
          buttonType === 'ghost'
            ? 'border border-gray-600 bg-black/35 text-white hover:border-gray-200 hover:bg-black/55 focus:border-gray-500 active:bg-black/70'
            : buttonType === 'playback'
              ? 'border border-gray-500 bg-black/35 text-gray-400 hover:border-white hover:bg-black/55 hover:text-white focus:border-white active:bg-black/70'
              : buttonType === 'detailRequest'
                ? 'border border-green-500/90 bg-green-950/35 text-green-200 hover:bg-green-900/55 focus:border-green-300 active:bg-green-900/70'
                : buttonType === 'success'
                  ? 'bg-green-950/35 text-white hover:bg-green-900/55 focus:border-green-700 active:bg-green-900/70'
                  : 'bg-indigo-950/35 text-white hover:bg-indigo-900/55 focus:border-indigo-700 active:bg-indigo-900/70',
        ].join(' ')}
        {...props}
      >
        {children}
      </a>
    </MenuItem>
  );
};

type DropdownItemsProps = HTMLAttributes<HTMLDivElement> & {
  dropdownType: DropdownButtonType;
};

const DropdownItems = ({
  children,
  className,
  dropdownType,
  ...props
}: DropdownItemsProps) => {
  return (
    <MenuItems
      transition
      className={[
        'absolute top-full right-0 z-40 mt-2 -mr-1 w-56 origin-top-right rounded-md p-1 shadow-lg transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0',
        dropdownType === 'ghost'
          ? 'border border-gray-700 bg-gray-800/80 backdrop-blur'
          : dropdownType === 'playback'
            ? 'border border-gray-500 bg-black/95 backdrop-blur'
            : dropdownType === 'detailRequest'
              ? 'border border-green-500/90 bg-gray-950/95 backdrop-blur'
              : dropdownType === 'success'
                ? 'bg-green-600'
                : 'bg-indigo-600',
        className,
      ].join(' ')}
      {...props}
    >
      <div className="py-1">{children}</div>
    </MenuItems>
  );
};

interface DropdownProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  text: React.ReactNode;
  dropdownIcon?: React.ReactNode;
  buttonType?: DropdownButtonType;
  buttonSize?: 'default' | 'md' | 'sm';
  disabledReason?: string;
}

const Dropdown = ({
  text,
  children,
  dropdownIcon,
  className,
  buttonType = 'primary',
  buttonSize = 'md',
  disabledReason,
  title,
  ...props
}: DropdownProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <Menu as="div" className="relative z-10 inline-flex">
      <MenuButton
        type="button"
        className={[
          buttonType === 'playback'
            ? `app-button app-button-playback playback-dropdown-trigger ${buttonSize === 'sm' ? 'button-sm' : 'button-md'}`
            : buttonType === 'ghost'
              ? `app-button app-button-ghost ${buttonSize === 'sm' ? 'button-sm' : 'button-md'}`
              : buttonType === 'detailRequest'
                ? `app-button app-button-detail-request ${buttonSize === 'sm' ? 'button-sm' : 'button-md'}`
                : buttonType === 'success'
                  ? `app-button app-button-success ${buttonSize === 'sm' ? 'button-sm' : 'button-md'}`
                  : `app-button app-button-primary ${buttonSize === 'sm' ? 'button-sm' : 'button-md'}`,
          buttonType === 'playback'
            ? 'hover:z-20 focus:z-20'
            : 'hover:z-20 focus:z-20 disabled:brightness-50 disabled:grayscale',
          className,
        ].join(' ')}
        ref={buttonRef}
        disabled={!children}
        data-button-help={title}
        data-disabled-reason={!children ? disabledReason : undefined}
        {...props}
      >
        <span className="inline-flex min-w-0 items-center">{text}</span>
        {children && (dropdownIcon ? dropdownIcon : <ChevronDownIcon />)}
      </MenuButton>
      {children && (
        <DropdownItems dropdownType={buttonType}>{children}</DropdownItems>
      )}
    </Menu>
  );
};
export default withProperties(Dropdown, {
  Item: DropdownItem,
  Items: DropdownItems,
});
