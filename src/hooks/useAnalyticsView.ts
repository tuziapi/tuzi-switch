import { useEffect, useRef } from "react";
import { trackInteraction } from "@/lib/analytics";

/** Ref survives StrictMode effect replay; repeat renders do not count as visits. */
export function useAnalyticsView(page: string, tool?: string) {
  const previous = useRef<string>();
  useEffect(() => {
    const key = `${page}:${tool ?? ""}`;
    if (previous.current === key) return;
    previous.current = key;
    trackInteraction("navigation", "view", { page, tool });
  }, [page, tool]);
}
