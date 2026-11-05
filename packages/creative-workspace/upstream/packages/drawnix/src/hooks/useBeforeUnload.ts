/**
 * useBeforeUnload Hook
 *
 * Warns users when they try to leave/refresh the page while LLM tasks are in progress.
 * Checks both active tasks in taskQueueService and running workflows.
 */

import { useEffect } from 'react';
import { hasActiveLLMTasksSync } from '../utils/active-tasks';

/**
 * Hook to prevent accidental page navigation when LLM tasks are active
 */
export function useBeforeUnload(): void {
  useEffect(() => {
    const handleBeforeUnload = (
      event: BeforeUnloadEvent
    ): string | undefined => {
      if (hasActiveLLMTasksSync()) {
        event.preventDefault();
        event.returnValue = '';
        return '';
      }
      return undefined;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);
}
