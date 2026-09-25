import { Permission, hasPermission } from '@server/lib/permissions';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface ViewAsUser {
  id: number;
  displayName: string;
  permissions: number;
}

interface ViewAsContextValue {
  viewedUser: ViewAsUser | null;
  setViewedUser: (user: ViewAsUser | null) => void;
}

export const ViewAsContext = createContext<ViewAsContextValue>({
  viewedUser: null,
  setViewedUser: () => undefined,
});

export const ViewAsProvider = ({
  viewer,
  children,
}: {
  viewer?: { id: number; permissions: number };
  children: ReactNode;
}) => {
  const [selection, setSelection] = useState<{
    viewerId: number;
    user: ViewAsUser;
  } | null>(null);
  const canPreview =
    !!viewer && hasPermission(Permission.ADMIN, viewer.permissions);
  const viewerId = viewer?.id;
  const viewedUser =
    canPreview && selection && selection.viewerId === viewerId
      ? selection.user
      : null;

  useEffect(() => {
    if (!canPreview || selection?.viewerId !== viewerId) {
      setSelection(null);
    }
  }, [canPreview, selection?.viewerId, viewerId]);

  const setViewedUser = useCallback(
    (user: ViewAsUser | null) =>
      setSelection(user && viewerId ? { viewerId, user } : null),
    [viewerId]
  );

  const value = useMemo<ViewAsContextValue>(
    () => ({
      viewedUser,
      setViewedUser,
    }),
    [viewedUser, setViewedUser]
  );

  return (
    <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>
  );
};
