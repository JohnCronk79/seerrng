import Tooltip from '@app/components/Common/Tooltip';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

export interface SelectableDownloadListItem {
  id: string;
  content: ReactNode;
  tooltip?: ReactNode;
}

interface SelectableDownloadListProps {
  items: SelectableDownloadListItem[];
}

type SelectionModifiers = Pick<
  MouseEvent<HTMLLIElement>,
  'shiftKey' | 'ctrlKey' | 'metaKey'
>;

const SelectableDownloadList = ({ items }: SelectableDownloadListProps) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | undefined>();
  const listRef = useRef<HTMLUListElement>(null);

  const itemIds = useMemo(() => items.map((item) => item.id), [items]);

  const getRangeIds = useCallback(
    (fromId: string, toId: string): string[] => {
      const fromIndex = itemIds.indexOf(fromId);
      const toIndex = itemIds.indexOf(toId);

      if (fromIndex === -1 || toIndex === -1) {
        return [toId];
      }

      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);

      return itemIds.slice(start, end + 1);
    },
    [itemIds]
  );

  const selectRange = useCallback(
    (targetId: string, additive: boolean) => {
      const rangeIds = getRangeIds(anchorId ?? targetId, targetId);

      setSelectedIds((currentIds) => {
        if (!additive) {
          return rangeIds;
        }

        return Array.from(new Set([...currentIds, ...rangeIds]));
      });
    },
    [anchorId, getRangeIds]
  );

  const selectRow = useCallback(
    (id: string, modifiers: SelectionModifiers) => {
      if (modifiers.shiftKey) {
        selectRange(id, modifiers.ctrlKey || modifiers.metaKey);
        return;
      }

      if (modifiers.ctrlKey || modifiers.metaKey) {
        setSelectedIds((currentIds) =>
          currentIds.includes(id)
            ? currentIds.filter((currentId) => currentId !== id)
            : [...currentIds, id]
        );
        setAnchorId(id);
        return;
      }

      setSelectedIds([id]);
      setAnchorId(id);
    },
    [selectRange]
  );

  const handleRowClick = useCallback(
    (event: MouseEvent<HTMLLIElement>, id: string) => {
      event.preventDefault();
      listRef.current?.focus();
      selectRow(id, event);
    },
    [selectRow]
  );

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLLIElement>, id: string) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      selectRow(id, event);
    },
    [selectRow]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedIds(itemIds);
        setAnchorId(itemIds[0]);
      }
    },
    [itemIds]
  );

  return (
    <ul
      ref={listRef}
      tabIndex={0}
      role="listbox"
      aria-multiselectable="true"
      onKeyDown={handleKeyDown}
      className="outline-none select-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      {items.map((item) => {
        const selected = selectedIds.includes(item.id);
        const row = (
          <li
            key={item.id}
            role="option"
            aria-selected={selected}
            tabIndex={0}
            onClick={(event) => handleRowClick(event, item.id)}
            onKeyDown={(event) => handleRowKeyDown(event, item.id)}
            className={`cursor-default border-b border-gray-700 transition-colors last:border-b-0 ${
              selected
                ? 'bg-indigo-500/25 ring-1 ring-indigo-400/60 ring-inset'
                : 'hover:bg-gray-700/40'
            }`}
          >
            {item.content}
          </li>
        );

        return item.tooltip ? (
          <Tooltip key={item.id} content={item.tooltip}>
            {row}
          </Tooltip>
        ) : (
          row
        );
      })}
    </ul>
  );
};

export default SelectableDownloadList;
