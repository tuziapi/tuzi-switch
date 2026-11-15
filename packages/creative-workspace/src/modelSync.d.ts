import type { CreativeAccountBridge } from "./bridge-types";
export interface ModelUpgradeSyncController {
  updateAccountBridge(bridge: CreativeAccountBridge): void;
  stop(): void;
}
export function startModelUpgradeSync(
  bridge: CreativeAccountBridge,
): ModelUpgradeSyncController;
