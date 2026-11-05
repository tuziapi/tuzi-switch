import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

export interface UseWorkflowNavigationOptions<
  TPageId extends string,
  TStepId extends TPageId
> {
  initialPage: TStepId;
  defaultPage: TStepId;
  historyPage: TPageId;
  setShowStarred: Dispatch<SetStateAction<boolean>>;
}

export interface UseWorkflowNavigationResult<
  TPageId extends string,
  TStepId extends TPageId
> {
  page: TPageId;
  setPage: Dispatch<SetStateAction<TPageId>>;
  navigateToStep: (target: TStepId) => void;
  goToDefaultPage: () => void;
  openHistory: () => void;
  openStarred: () => void;
  toggleStarred: () => void;
}

export function useWorkflowNavigation<
  TPageId extends string,
  TStepId extends TPageId
>({
  initialPage,
  defaultPage,
  historyPage,
  setShowStarred,
}: UseWorkflowNavigationOptions<TPageId, TStepId>): UseWorkflowNavigationResult<
  TPageId,
  TStepId
> {
  const [page, setPage] = useState<TPageId>(initialPage);

  const navigateToStep = useCallback((target: TStepId) => {
    setPage(target);
  }, []);

  const goToDefaultPage = useCallback(() => {
    setPage(defaultPage);
  }, [defaultPage]);

  const openHistory = useCallback(() => {
    setShowStarred(false);
    setPage(historyPage);
  }, [historyPage, setShowStarred]);

  const openStarred = useCallback(() => {
    setShowStarred(true);
    setPage(historyPage);
  }, [historyPage, setShowStarred]);

  const toggleStarred = useCallback(() => {
    setShowStarred((value) => !value);
  }, [setShowStarred]);

  return {
    page,
    setPage,
    navigateToStep,
    goToDefaultPage,
    openHistory,
    openStarred,
    toggleStarred,
  };
}
