import { useEffect, useRef } from "react";
import type { CreativeAccountBridge } from "@tuzi/creative-workspace";
import type { ModelUpgradeSyncController } from "@tuzi/creative-workspace/model-sync";

/** Start metadata-only discovery even when the user stays on the account page. */
export function useModelUpgradeSync(bridge: CreativeAccountBridge) {
  const currentBridge = useRef(bridge);
  currentBridge.current = bridge;
  const controller = useRef<ModelUpgradeSyncController>();
  useEffect(() => {
    controller.current?.updateAccountBridge(bridge);
  }, [bridge]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void import("@tuzi/creative-workspace/model-sync")
        .then((module) => {
          if (!cancelled)
            controller.current = module.startModelUpgradeSync(
              currentBridge.current,
            );
        })
        .catch(() => {
          console.warn("创作模型自动同步暂未启动，下次启动将重试。");
        });
    }, 1_500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.current?.stop();
      controller.current = undefined;
    };
  }, []);
}
