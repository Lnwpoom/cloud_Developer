/**
 * A set of change listeners: what backs every `onChange` in this service.
 */
export type Listeners<T> = {
  /** Calls `listener` on every later `notify`. Returns a function that unsubscribes it. */
  readonly add: (listener: (change: T) => void) => () => void;
  readonly notify: (change: T) => void;
};

export const createListeners = <T>(): Listeners<T> => {
  const listeners = new Set<(change: T) => void>();
  return {
    add: (listener) => {
      // A fresh wrapper per call, so adding the same function twice gives two independent subscriptions.
      const subscription = (change: T): void => {
        listener(change);
      };
      listeners.add(subscription);
      return () => listeners.delete(subscription);
    },
    notify: (change) => {
      for (const listener of listeners) listener(change);
    },
  };
};
