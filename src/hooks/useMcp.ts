import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mcpApi } from "@/lib/api/mcp";
import type { McpServer } from "@/types";
import type { AppId } from "@/lib/api/types";
import type { NativeTool } from "@/lib/api/nativeTools";

/**
 * 查询所有 MCP 服务器（统一管理）
 */
export function useAllMcpServers() {
  return useQuery({
    queryKey: ["mcp", "all"],
    queryFn: () => mcpApi.getAllServers(),
  });
}

/**
 * 添加或更新 MCP 服务器
 */
export function useUpsertMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (server: McpServer) => mcpApi.upsertUnifiedServer(server),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    },
  });
}

/**
 * 切换 MCP 服务器在特定应用的启用状态
 */
export function useToggleMcpApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      serverId,
      app,
      enabled,
    }: {
      serverId: string;
      app: AppId | NativeTool;
      enabled: boolean;
    }) => mcpApi.toggleApp(serverId, app, enabled),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    },
  });
}

/**
 * 删除 MCP 服务器
 */
export function useDeleteMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mcpApi.deleteUnifiedServer(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    },
  });
}

/**
 * 从所有应用导入 MCP 服务器
 */
export function useImportMcpFromApps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => mcpApi.importFromApps(),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    },
  });
}
