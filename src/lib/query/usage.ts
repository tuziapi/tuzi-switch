import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usageApi } from "@/lib/api/usage";
import type { BusinessLineFilter, LogFilters } from "@/types/usage";

const DEFAULT_REFETCH_INTERVAL_MS = 30000;

type UsageQueryOptions = {
  refetchInterval?: number | false;
  refetchIntervalInBackground?: boolean;
};

type RequestLogsTimeMode = "rolling" | "fixed";

type RequestLogsQueryArgs = {
  filters: LogFilters;
  timeMode: RequestLogsTimeMode;
  page?: number;
  pageSize?: number;
  rollingWindowSeconds?: number;
  options?: UsageQueryOptions;
};

type RequestLogsKey = {
  timeMode: RequestLogsTimeMode;
  rollingWindowSeconds?: number;
  appType?: string;
  businessLine?: string;
  providerName?: string;
  model?: string;
  statusCode?: number;
  startDate?: number;
  endDate?: number;
};

// Query keys
export const usageKeys = {
  all: ["usage"] as const,
  tuziKeyUsage: (keyFingerprint: string) =>
    [...usageKeys.all, "tuzi-key-usage", keyFingerprint] as const,
  tuziWorkspaceSummary: (keyFingerprint: string) =>
    [...usageKeys.all, "tuzi-workspace-summary", keyFingerprint] as const,
  tuziWorkspaceTrends: (keyFingerprint: string, days: number) =>
    [...usageKeys.all, "tuzi-workspace-trends", keyFingerprint, days] as const,
  tuziWorkspaceDistribution: (keyFingerprint: string, days: number) =>
    [
      ...usageKeys.all,
      "tuzi-workspace-distribution",
      keyFingerprint,
      days,
    ] as const,
  summary: (days: number, businessLine: BusinessLineFilter) =>
    [...usageKeys.all, "summary", days, businessLine] as const,
  trends: (days: number, businessLine: BusinessLineFilter) =>
    [...usageKeys.all, "trends", days, businessLine] as const,
  providerStats: (businessLine: BusinessLineFilter) =>
    [...usageKeys.all, "provider-stats", businessLine] as const,
  modelStats: (businessLine: BusinessLineFilter) =>
    [...usageKeys.all, "model-stats", businessLine] as const,
  logs: (key: RequestLogsKey, page: number, pageSize: number) =>
    [
      ...usageKeys.all,
      "logs",
      key.timeMode,
      key.rollingWindowSeconds ?? 0,
      key.appType ?? "",
      key.businessLine ?? "",
      key.providerName ?? "",
      key.model ?? "",
      key.statusCode ?? -1,
      key.startDate ?? 0,
      key.endDate ?? 0,
      page,
      pageSize,
    ] as const,
  detail: (requestId: string) =>
    [...usageKeys.all, "detail", requestId] as const,
  pricing: () => [...usageKeys.all, "pricing"] as const,
  limits: (providerId: string, appType: string) =>
    [...usageKeys.all, "limits", providerId, appType] as const,
};

const getWindow = (days: number) => {
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - days * 24 * 60 * 60;
  return { startDate, endDate };
};

// Hooks
export function useUsageSummary(
  days: number,
  businessLine: BusinessLineFilter,
  options?: UsageQueryOptions,
) {
  return useQuery({
    queryKey: usageKeys.summary(days, businessLine),
    queryFn: () => {
      const { startDate, endDate } = getWindow(days);
      return usageApi.getUsageSummary(
        startDate,
        endDate,
        businessLine === "all" ? undefined : businessLine,
      );
    },
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS, // 每30秒自动刷新
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false, // 后台不刷新
  });
}

export function useUsageTrends(
  days: number,
  businessLine: BusinessLineFilter,
  options?: UsageQueryOptions,
) {
  return useQuery({
    queryKey: usageKeys.trends(days, businessLine),
    queryFn: () => {
      const { startDate, endDate } = getWindow(days);
      return usageApi.getUsageTrends(
        startDate,
        endDate,
        businessLine === "all" ? undefined : businessLine,
      );
    },
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS, // 每30秒自动刷新
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useProviderStats(
  businessLine: BusinessLineFilter,
  options?: UsageQueryOptions,
) {
  return useQuery({
    queryKey: usageKeys.providerStats(businessLine),
    queryFn: () =>
      usageApi.getProviderStats(
        businessLine === "all" ? undefined : businessLine,
      ),
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS, // 每30秒自动刷新
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useModelStats(
  businessLine: BusinessLineFilter,
  options?: UsageQueryOptions,
) {
  return useQuery({
    queryKey: usageKeys.modelStats(businessLine),
    queryFn: () =>
      usageApi.getModelStats(businessLine === "all" ? undefined : businessLine),
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS, // 每30秒自动刷新
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

const getRollingRange = (windowSeconds: number) => {
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - windowSeconds;
  return { startDate, endDate };
};

export function useRequestLogs({
  filters,
  timeMode,
  page = 0,
  pageSize = 20,
  rollingWindowSeconds = 24 * 60 * 60,
  options,
}: RequestLogsQueryArgs) {
  const key: RequestLogsKey = {
    timeMode,
    rollingWindowSeconds:
      timeMode === "rolling" ? rollingWindowSeconds : undefined,
    appType: filters.appType,
    businessLine: filters.businessLine,
    providerName: filters.providerName,
    model: filters.model,
    statusCode: filters.statusCode,
    startDate: timeMode === "fixed" ? filters.startDate : undefined,
    endDate: timeMode === "fixed" ? filters.endDate : undefined,
  };

  return useQuery({
    queryKey: usageKeys.logs(key, page, pageSize),
    queryFn: () => {
      const effectiveFilters =
        timeMode === "rolling"
          ? { ...filters, ...getRollingRange(rollingWindowSeconds) }
          : filters;
      return usageApi.getRequestLogs(effectiveFilters, page, pageSize);
    },
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS, // 每30秒自动刷新
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useRequestDetail(requestId: string) {
  return useQuery({
    queryKey: usageKeys.detail(requestId),
    queryFn: () => usageApi.getRequestDetail(requestId),
    enabled: !!requestId,
  });
}

export function useModelPricing() {
  return useQuery({
    queryKey: usageKeys.pricing(),
    queryFn: usageApi.getModelPricing,
  });
}

export function useProviderLimits(providerId: string, appType: string) {
  return useQuery({
    queryKey: usageKeys.limits(providerId, appType),
    queryFn: () => usageApi.checkProviderLimits(providerId, appType),
    enabled: !!providerId && !!appType,
  });
}

export function useTuziKeyUsage(
  apiKey?: string,
  options?: UsageQueryOptions & { enabled?: boolean },
) {
  const normalizedKey = apiKey?.trim() || "";
  const keyFingerprint = normalizedKey
    ? `${normalizedKey.slice(0, 4)}:${normalizedKey.slice(-4)}:${normalizedKey.length}`
    : "none";

  return useQuery({
    queryKey: usageKeys.tuziKeyUsage(keyFingerprint),
    queryFn: () => usageApi.getTuziKeyUsage(normalizedKey),
    enabled: (options?.enabled ?? true) && normalizedKey.length > 0,
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

function getTuziWorkspaceKeyFingerprint(apiKey?: string) {
  const normalizedKey = apiKey?.trim() || "";
  return normalizedKey
    ? `${normalizedKey.slice(0, 4)}:${normalizedKey.slice(-4)}:${normalizedKey.length}`
    : "none";
}

export function useTuziWorkspaceSummary(
  apiKey?: string,
  options?: UsageQueryOptions & { enabled?: boolean },
) {
  const normalizedKey = apiKey?.trim() || "";
  const keyFingerprint = getTuziWorkspaceKeyFingerprint(normalizedKey);

  return useQuery({
    queryKey: usageKeys.tuziWorkspaceSummary(keyFingerprint),
    queryFn: () => usageApi.getTuziWorkspaceSummary(normalizedKey),
    enabled: (options?.enabled ?? true) && normalizedKey.length > 0,
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useTuziWorkspaceTrends(
  apiKey?: string,
  days: number = 7,
  options?: UsageQueryOptions & { enabled?: boolean },
) {
  const normalizedKey = apiKey?.trim() || "";
  const keyFingerprint = getTuziWorkspaceKeyFingerprint(normalizedKey);

  return useQuery({
    queryKey: usageKeys.tuziWorkspaceTrends(keyFingerprint, days),
    queryFn: () => usageApi.getTuziWorkspaceTrends(normalizedKey, days),
    enabled: (options?.enabled ?? true) && normalizedKey.length > 0,
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useTuziWorkspaceDistribution(
  apiKey?: string,
  days: number = 30,
  options?: UsageQueryOptions & { enabled?: boolean },
) {
  const normalizedKey = apiKey?.trim() || "";
  const keyFingerprint = getTuziWorkspaceKeyFingerprint(normalizedKey);

  return useQuery({
    queryKey: usageKeys.tuziWorkspaceDistribution(keyFingerprint, days),
    queryFn: () => usageApi.getTuziWorkspaceDistribution(normalizedKey, days),
    enabled: (options?.enabled ?? true) && normalizedKey.length > 0,
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useUpdateModelPricing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      modelId: string;
      displayName: string;
      inputCost: string;
      outputCost: string;
      cacheReadCost: string;
      cacheCreationCost: string;
    }) =>
      usageApi.updateModelPricing(
        params.modelId,
        params.displayName,
        params.inputCost,
        params.outputCost,
        params.cacheReadCost,
        params.cacheCreationCost,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usageKeys.pricing() });
    },
  });
}

export function useDeleteModelPricing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modelId: string) => usageApi.deleteModelPricing(modelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usageKeys.pricing() });
    },
  });
}
