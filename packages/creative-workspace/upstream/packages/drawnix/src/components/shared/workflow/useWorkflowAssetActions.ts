import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseWorkflowAssetActionsOptions<TResult> {
  onExport: (onProgress: (progress: number) => void) => Promise<TResult>;
  onExportSuccess?: (result: TResult) => void;
  onExportError?: (error: unknown) => void;
  resetDelayMs?: number;
}

export interface WorkflowAssetActionsState {
  isExportingAssets: boolean;
  exportProgress: number;
  handleExportAssets: () => Promise<void>;
}

export function useWorkflowAssetActions<TResult>({
  onExport,
  onExportSuccess,
  onExportError,
  resetDelayMs = 300,
}: UseWorkflowAssetActionsOptions<TResult>): WorkflowAssetActionsState {
  const [isExportingAssets, setIsExportingAssets] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const resetTimerRef = useRef<number | null>(null);
  const exportingRef = useRef(false);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearResetTimer, [clearResetTimer]);

  const handleExportAssets = useCallback(async () => {
    if (exportingRef.current) {
      return;
    }

    exportingRef.current = true;
    setIsExportingAssets(true);
    setExportProgress(0);

    try {
      const result = await onExport(setExportProgress);
      onExportSuccess?.(result);
    } catch (error) {
      onExportError?.(error);
    } finally {
      clearResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        exportingRef.current = false;
        setIsExportingAssets(false);
        setExportProgress(0);
      }, resetDelayMs);
    }
  }, [clearResetTimer, onExport, onExportError, onExportSuccess, resetDelayMs]);

  return {
    isExportingAssets,
    exportProgress,
    handleExportAssets,
  };
}
