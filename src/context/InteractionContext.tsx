import useInteraction from '@app/hooks/useInteraction';
import React, { useMemo } from 'react';

interface InteractionContextProps {
  isTouch?: boolean;
  children?: React.ReactNode;
}

export const InteractionContext = React.createContext<InteractionContextProps>({
  isTouch: false,
});

export const InteractionProvider = ({ children }: InteractionContextProps) => {
  const isTouch = useInteraction();
  const value = useMemo(() => ({ isTouch }), [isTouch]);

  return (
    <InteractionContext.Provider value={value}>
      {children}
    </InteractionContext.Provider>
  );
};
