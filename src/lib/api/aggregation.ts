import { invoke } from "@tauri-apps/api/core";
export interface AggregationModel {
  providerId: string;
  model: string;
  displayName: string;
  contextWindow: number;
}
export interface AggregationPlan {
  defaultProviderId: string;
  models: AggregationModel[];
}
export interface AggregationState {
  enabled: boolean;
  needsRecovery: boolean;
  plan: AggregationPlan;
}
export const aggregationApi = {
  read: (appName: string) =>
    invoke<AggregationState>("aggregation_read", { appName }),
  apply: (appName: string, plan: AggregationPlan, enabled: boolean) =>
    invoke<void>("aggregation_apply", { appName, plan, enabled }),
};
