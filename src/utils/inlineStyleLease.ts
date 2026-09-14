export type InlineStyleProperty =
  'overflow' | 'overscrollBehavior' | 'overscrollBehaviorY' | 'touchAction';

type InlineStyleLeaseState = {
  originalValue: string;
  leases: Map<symbol, string>;
};

const styleLeases = new WeakMap<
  HTMLElement,
  Map<InlineStyleProperty, InlineStyleLeaseState>
>();

/**
 * Applies an inline style until the returned lease is released. Overlapping
 * leases are restored in ownership order, including when released out of order.
 */
export const acquireInlineStyleLease = (
  element: HTMLElement,
  property: InlineStyleProperty,
  value: string
): (() => void) => {
  let elementLeases = styleLeases.get(element);
  if (!elementLeases) {
    elementLeases = new Map();
    styleLeases.set(element, elementLeases);
  }

  let state = elementLeases.get(property);
  if (!state) {
    state = {
      originalValue: element.style[property],
      leases: new Map(),
    };
    elementLeases.set(property, state);
  }

  const token = Symbol(property);
  state.leases.set(token, value);
  element.style[property] = value;
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;

    const currentElementLeases = styleLeases.get(element);
    const currentState = currentElementLeases?.get(property);
    if (!currentState || !currentState.leases.delete(token)) {
      return;
    }

    const remainingValues = [...currentState.leases.values()];
    const previousValue = remainingValues.at(-1);
    if (previousValue !== undefined) {
      element.style[property] = previousValue;
      return;
    }

    element.style[property] = currentState.originalValue;
    currentElementLeases?.delete(property);
    if (currentElementLeases?.size === 0) {
      styleLeases.delete(element);
    }
  };
};
