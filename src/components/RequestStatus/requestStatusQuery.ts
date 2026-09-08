export type RequestStatusUserSelection = number | 'all' | null;

export const canLoadRequestStatus = ({
  currentUserId,
  canViewOtherUsers,
  selectedUser,
}: {
  currentUserId?: number;
  canViewOtherUsers: boolean;
  selectedUser: RequestStatusUserSelection;
}): boolean =>
  currentUserId !== undefined && (!canViewOtherUsers || selectedUser !== null);
