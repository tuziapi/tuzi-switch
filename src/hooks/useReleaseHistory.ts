import { useEffect, useRef, useState } from "react";
import {
  cacheReleaseHistory,
  fetchReleaseHistory,
  HISTORY_STALE_MS,
  mergeReleaseHistory,
  readReleaseHistoryCache,
} from "@/lib/releaseHistory";

export function useReleaseHistory(open: boolean) {
  const [releases, setReleases] = useState(() => mergeReleaseHistory());
  const [status, setStatus] = useState<
    "local" | "syncing" | "synced" | "offline"
  >("local");
  const lastFailure = useRef(0);
  useEffect(() => {
    if (!open) return;
    const cached = readReleaseHistoryCache();
    if (cached) setReleases(mergeReleaseHistory(cached));
    if (cached && Date.now() - cached.fetchedAt < HISTORY_STALE_MS) {
      setStatus("synced");
      return;
    }
    if (Date.now() - lastFailure.current < 5 * 60_000) return;
    const controller = new AbortController();
    setStatus("syncing");
    void fetchReleaseHistory(controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        setReleases(mergeReleaseHistory(snapshot));
        cacheReleaseHistory(snapshot);
        setStatus("synced");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        lastFailure.current = Date.now();
        setStatus("offline");
      });
    return () => controller.abort();
  }, [open]);
  return { releases, status };
}
