import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { backupsApi } from "@/lib/api";
import { track } from "@/lib/analytics";

export function useBackupManager() {
  const queryClient = useQueryClient();

  const {
    data: backups = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["db-backups"],
    queryFn: () => backupsApi.listDbBackups(),
  });

  const createMutation = useMutation({
    mutationFn: () => backupsApi.createDbBackup(),
    onSuccess: () => {
      track("config_action", { action: "backup", result: "success" });
      return refetch();
    },
    onError: () => track("config_action", { action: "backup", result: "failed" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (filename: string) => backupsApi.restoreDbBackup(filename),
    onSuccess: async () => {
      track("config_action", { action: "restore", result: "success" });
      // Invalidate all queries to refresh data from restored database
      await queryClient.invalidateQueries();
      // Refetch backup list
      await refetch();
    },
    onError: () => track("config_action", { action: "restore", result: "failed" }),
  });

  const renameMutation = useMutation({
    mutationFn: ({
      oldFilename,
      newName,
    }: {
      oldFilename: string;
      newName: string;
    }) => backupsApi.renameDbBackup(oldFilename, newName),
    onSuccess: () => refetch(),
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => backupsApi.deleteDbBackup(filename),
    onSuccess: () => refetch(),
  });

  return {
    backups,
    isLoading,
    create: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    restore: restoreMutation.mutateAsync,
    isRestoring: restoreMutation.isPending,
    rename: renameMutation.mutateAsync,
    isRenaming: renameMutation.isPending,
    remove: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  };
}
