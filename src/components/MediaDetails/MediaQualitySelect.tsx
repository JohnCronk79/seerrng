import defineMessages from '@app/utils/defineMessages';
import { Listbox, Transition } from '@headlessui/react';
import { AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline';
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/solid';
import { Fragment } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MediaDetails.MediaQualitySelect', {
  selectQuality: 'Select Quality',
});

interface MediaQualitySelectProps<Quality extends string> {
  value: Quality;
  options: { label: string; value: Quality }[];
  onChange: (quality: Quality) => void;
  className?: string;
}

const MediaQualitySelect = <Quality extends string>({
  value,
  options,
  onChange,
  className = '',
}: MediaQualitySelectProps<Quality>) => {
  const intl = useIntl();
  const label = intl.formatMessage(messages.selectQuality);
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <Listbox
      value={selected}
      onChange={(option) => onChange(option.value as Quality)}
    >
      <div className={`relative w-max max-w-full ${className}`}>
        <Listbox.Button
          aria-label={`${label}: ${selected?.label ?? ''}`}
          className="app-button app-button-detail-request button-sm group min-w-0 gap-2 px-2"
        >
          <AdjustmentsHorizontalIcon className="flex-none" aria-hidden="true" />
          <span className="truncate">{label}</span>
          <span className="border-l border-green-500/50 pl-2 font-semibold text-green-100">
            {selected?.label}
          </span>
          <ChevronDownIcon
            className="flex-none text-green-300 transition group-data-open:rotate-180"
            aria-hidden="true"
          />
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute top-full right-0 z-50 mt-1 min-w-full overflow-hidden rounded-md border border-green-500/90 bg-gray-950/95 py-1 text-xs shadow-xl backdrop-blur focus:outline-none">
            {options.map((option) => (
              <Listbox.Option
                key={option.value}
                value={option}
                className={({ active }) =>
                  `relative cursor-default py-1.5 pr-3 pl-8 select-none ${
                    active ? 'bg-green-900/70 text-white' : 'text-green-200'
                  }`
                }
              >
                {({ selected: optionSelected }) => (
                  <>
                    {optionSelected && (
                      <CheckIcon
                        className="absolute top-1.5 left-2 h-4 w-4 text-green-300"
                        aria-hidden="true"
                      />
                    )}
                    <span className="block truncate font-medium">
                      {option.label}
                    </span>
                  </>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
};

export default MediaQualitySelect;
