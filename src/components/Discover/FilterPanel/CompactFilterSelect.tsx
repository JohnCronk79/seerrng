import { Listbox, Transition } from '@headlessui/react';
import { StarIcon as OutlineStarIcon } from '@heroicons/react/24/outline';
import {
  CheckIcon,
  ChevronDownIcon,
  StarIcon as SolidStarIcon,
} from '@heroicons/react/24/solid';
import { Fragment } from 'react';

export const getFilterResetButtonClass = (selected: boolean) =>
  `inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-[9px] text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
    selected
      ? 'border-indigo-400 bg-indigo-500 text-white'
      : 'border-gray-700 bg-gray-900/40 text-gray-500 hover:border-gray-500 hover:text-gray-300'
  }`;

export const getFilterToggleButtonClass = (selected: boolean) =>
  `inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-[9px] text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
    selected
      ? 'border-indigo-400 bg-indigo-500 text-white'
      : 'border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400 hover:text-white'
  }`;

export type CompactSelectOption = {
  label: string;
  value: string;
};

export type RangeOption = CompactSelectOption & {
  gte?: string;
  lte?: string;
};

export type RatingOption = RangeOption & {
  score?: number;
};

type CompactSelectProps = {
  label: string;
  value: string;
  options: CompactSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  defaultValue?: string;
};

export const CompactSelect = ({
  label,
  value,
  options,
  onChange,
  className = '',
  defaultValue,
}: CompactSelectProps) => {
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  const isActive = value !== (defaultValue ?? options[0]?.value);

  return (
    <Listbox value={selected} onChange={(option) => onChange(option.value)}>
      <div className={`discover-filter-control relative ${className}`}>
        <span
          className={`discover-filter-control-label ${
            isActive ? 'discover-filter-control-label-active' : ''
          }`}
        >
          {label}
        </span>
        <Listbox.Button
          aria-label={label}
          className="flex min-w-0 flex-none items-center gap-1.5 px-2 py-1 text-left text-xs font-medium text-gray-300 focus:outline-none"
        >
          <span className="max-w-48 truncate">{selected.label}</span>
          <ChevronDownIcon
            className="h-4 w-4 flex-none text-gray-500"
            aria-hidden="true"
          />
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute left-0 top-full z-50 mt-1 max-h-60 w-max min-w-full max-w-80 overflow-auto rounded-md border border-gray-600 bg-gray-800 py-1 text-xs shadow-xl focus:outline-none">
            {options.map((option) => (
              <Listbox.Option
                key={option.value}
                value={option}
                className={({ active }) =>
                  `relative cursor-default select-none py-1 pl-7 pr-2 ${
                    active ? 'bg-indigo-600 text-white' : 'text-gray-300'
                  }`
                }
              >
                {({ selected: optionSelected }) => (
                  <>
                    {optionSelected && (
                      <CheckIcon
                        className="absolute left-1.5 top-1 h-4 w-4 text-indigo-200"
                        aria-hidden="true"
                      />
                    )}
                    <span className="block truncate">{option.label}</span>
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

const RatingStars = ({
  score,
  maxScore,
}: {
  score: number;
  maxScore: 5 | 10;
}) => (
  <span className="inline-flex gap-px" aria-hidden="true">
    {[0, 1, 2, 3, 4].map((starIndex) => {
      const fill = Math.max(0, Math.min(1, (score / maxScore) * 5 - starIndex));

      return (
        <span key={starIndex} className="relative h-3.5 w-3.5">
          <OutlineStarIcon className="absolute h-3.5 w-3.5 text-gray-500" />
          {fill > 0 && (
            <span
              className="absolute inset-y-0 left-0 overflow-hidden"
              style={{ width: `${fill * 100}%` }}
            >
              <SolidStarIcon className="h-3.5 w-3.5 max-w-none text-yellow-400" />
            </span>
          )}
        </span>
      );
    })}
  </span>
);

type CompactRatingSelectProps = {
  label: string;
  value: string;
  options: RatingOption[];
  onChange: (value: string) => void;
  maxScore?: 5 | 10;
  className?: string;
  defaultValue?: string;
};

export const CompactRatingSelect = ({
  label,
  value,
  options,
  onChange,
  maxScore = 10,
  className = '',
  defaultValue,
}: CompactRatingSelectProps) => {
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  const selectedHasScore = selected.score !== undefined;
  const isActive = value !== (defaultValue ?? options[0]?.value);

  return (
    <Listbox value={selected} onChange={(option) => onChange(option.value)}>
      <div className={`discover-filter-control relative ${className}`}>
        <span
          className={`discover-filter-control-label ${
            isActive ? 'discover-filter-control-label-active' : ''
          }`}
        >
          {label}
        </span>
        <Listbox.Button
          aria-label={label}
          className="flex min-w-0 flex-none items-center gap-1 px-2 py-1 text-xs font-medium text-gray-300 focus:outline-none"
        >
          {selectedHasScore ? (
            <RatingStars score={selected.score ?? 0} maxScore={maxScore} />
          ) : (
            <span className="max-w-48 truncate text-left">
              {selected.label}
            </span>
          )}
          <ChevronDownIcon
            className="h-4 w-4 flex-none text-gray-500"
            aria-hidden="true"
          />
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute left-0 top-full z-50 mt-1 w-max min-w-full max-w-80 overflow-visible rounded-md border border-gray-600 bg-gray-800 py-1 text-xs shadow-xl focus:outline-none">
            {options.map((option) => {
              const hasScore = option.score !== undefined;

              return (
                <Listbox.Option
                  key={option.value}
                  value={option}
                  className={({ active }) =>
                    `relative flex cursor-default select-none items-center gap-1 py-1 pl-7 pr-2 ${
                      active ? 'bg-indigo-600 text-white' : 'text-gray-300'
                    }`
                  }
                >
                  {({ selected: optionSelected }) => (
                    <>
                      {optionSelected && (
                        <CheckIcon
                          className="absolute left-1.5 top-1 h-4 w-4 text-indigo-200"
                          aria-hidden="true"
                        />
                      )}
                      {hasScore ? (
                        <RatingStars
                          score={option.score ?? 0}
                          maxScore={maxScore}
                        />
                      ) : (
                        <span className="block truncate">{option.label}</span>
                      )}
                    </>
                  )}
                </Listbox.Option>
              );
            })}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
};
