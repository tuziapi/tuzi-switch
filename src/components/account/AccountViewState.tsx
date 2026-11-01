import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

// Only navigation preferences live here. Forms, account data and secrets never do.
const ViewState = createContext<{
  values: Record<string, unknown>;
  setValues: Dispatch<SetStateAction<Record<string, unknown>>>;
} | null>(null);

export function AccountViewState({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  return (
    <ViewState.Provider value={{ values, setValues }}>
      {children}
    </ViewState.Provider>
  );
}

export function useAccountViewState<T>(
  name: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(ViewState);
  const [local, setLocal] = useState(initial);
  if (!context) return [local, setLocal];
  return [
    (context.values[name] as T | undefined) ?? initial,
    (action) => {
      context.setValues((previous) => {
        const value = (previous[name] as T | undefined) ?? initial;
        return {
          ...previous,
          [name]:
            typeof action === "function"
              ? (action as (v: T) => T)(value)
              : action,
        };
      });
    },
  ];
}
