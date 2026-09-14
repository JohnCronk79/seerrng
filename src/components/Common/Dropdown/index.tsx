import { withProperties } from '@app/utils/typeHelpers';
import { Menu } from '@headlessui/react';
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
    <Menu.Item>
      <a
        className={[
          'button-md flex cursor-pointer items-center rounded px-4 py-2 text-sm leading-5 focus:text-white focus:outline-none',
          buttonType === 'ghost'
            ? 'bg-transparent from-indigo-600 to-purple-600 text-white hover:bg-gradient-to-br focus:border-gray-500'
            : buttonType === 'playback'
              ? 'border border-gray-500 bg-black text-gray-400 hover:border-white hover:text-white focus:border-white'
              : buttonType === 'detailRequest'
                ? 'border border-green-500/90 bg-green-950/95 text-green-200 hover:bg-green-900 focus:border-green-300'
                : buttonType === 'success'
                  ? 'bg-green-600 text-white hover:bg-green-500 focus:border-green-700'
                  : 'bg-indigo-600 text-white hover:bg-indigo-500 focus:border-indigo-700',
        ].join(' ')}
        {...props}
      >
        {children}
      </a>
    </Menu.Item>
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
    <Menu.Items
      transition
      className={[
        'absolute right-0 z-40 mt-2 -mr-1 w-56 origin-top-right rounded-md p-1 shadow-lg transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0',
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
    </Menu.Items>
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
    <Menu as="div" className="relative z-10">
      <Menu.Button
        type="button"
        className={[
          `${buttonSize === 'sm' ? 'button-sm' : 'button-md'} inline-flex items-center gap-2 rounded-md border leading-5 font-medium transition duration-150 ease-in-out hover:z-20 focus:z-20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:brightness-50 disabled:grayscale`,
          buttonType === 'ghost'
            ? 'border-gray-600 bg-transparent text-white hover:border-gray-200 focus:border-gray-100 active:border-gray-100'
            : buttonType === 'playback'
              ? 'border-gray-500 bg-black text-gray-400 hover:border-white hover:text-white focus:border-white active:border-white active:text-white'
              : buttonType === 'detailRequest'
                ? 'focus:ring-green border-green-500/90 bg-green-950/35 text-green-300 hover:border-green-300 hover:bg-green-900/55 hover:text-green-100 focus:border-green-300 active:border-green-400 active:bg-green-900/70'
                : buttonType === 'success'
                  ? 'focus:ring-green border-green-500 bg-green-500/80 text-white hover:border-green-400 hover:bg-green-500 focus:border-green-700 active:border-green-700 active:bg-green-600'
                  : `focus:ring-blue border-indigo-500 bg-indigo-600/80 text-white hover:border-indigo-500 hover:bg-indigo-600 active:border-indigo-700 active:bg-indigo-700`,
          className,
        ].join(' ')}
        ref={buttonRef}
        disabled={!children}
        title={!children ? disabledReason : title}
        {...props}
      >
        <span className="inline-flex min-w-0 items-center">{text}</span>
        {children && (dropdownIcon ? dropdownIcon : <ChevronDownIcon />)}
      </Menu.Button>
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
