import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  nativeToolsApi,
  nativeToolNames,
  nativeToolTemplate,
  type NativeTool,
  type NativeToolChange,
} from "@/lib/api/nativeTools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspaceQueryError } from "@/components/common/WorkspaceQueryError";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function nativeProviderName(config: unknown): string | undefined {
  if (!config || typeof config !== "object") return;
  const value = config as { name?: unknown; models?: { name?: unknown }[] };
  const name =
    value.name ??
    (Array.isArray(value.models) ? value.models[0]?.name : undefined);
  return typeof name === "string" && name.trim() ? name : undefined;
}

export function NativeToolPage({
  tool,
  focusRequest,
  onFocusComplete,
}: {
  tool: NativeTool;
  focusRequest?: { providerId?: string };
  onFocusComplete?: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const queryKey = ["nativeTool", tool];
  const query = useQuery({
    queryKey,
    queryFn: () => nativeToolsApi.read(tool),
    retry: false,
    gcTime: 0,
  });
  const [editor, setEditor] = useState<{
    id: string;
    config: string;
    existing: boolean;
    revision: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: "restore" | "delete";
    id?: string;
    revision: string;
  } | null>(null);
  const [error, setError] = useState<string>();
  const [located, setLocated] = useState<string>();
  const focusId = focusRequest?.providerId;
  const available = !!focusId && !!query.data?.providers[focusId];
  useEffect(() => {
    if (!focusId || !available) return;
    const begin = window.setTimeout(() => {
      document
        .getElementById(`native-provider-${tool}-${focusId}`)
        ?.scrollIntoView?.({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
      setLocated(focusId);
    }, 100);
    const finish = window.setTimeout(() => {
      setLocated(undefined);
      onFocusComplete?.();
    }, 2500);
    return () => {
      window.clearTimeout(begin);
      window.clearTimeout(finish);
      setLocated(undefined);
    };
  }, [focusRequest, focusId, available, tool, onFocusComplete]);
  const mutation = useMutation({
    mutationFn: (change: NativeToolChange | "restore") =>
      change === "restore"
        ? nativeToolsApi.restore(tool, confirm!.revision)
        : nativeToolsApi.write(tool, change),
    onSuccess: (data) => {
      client.setQueryData(queryKey, data);
      setEditor(null);
      setConfirm(null);
      setError(undefined);
      void client.invalidateQueries({ queryKey: ["tuziProviderSources"] });
    },
    onError: () => setError(t("nativeTools.failed")),
  });
  const save = () => {
    if (!editor || !query.data) return;
    try {
      const config = JSON.parse(editor.config);
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        setError(t("nativeTools.invalidJson"));
        return;
      }
      if (
        !editor.id.trim() ||
        (!editor.existing &&
          Object.prototype.hasOwnProperty.call(query.data.providers, editor.id))
      ) {
        setError(t("nativeTools.idConflict"));
        return;
      }
      mutation.mutate({ revision: editor.revision, id: editor.id, config });
    } catch {
      setError(t("nativeTools.invalidJson"));
    }
  };
  return (
    <div className="px-6 flex flex-col flex-1 min-h-0 overflow-y-auto gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{nativeToolNames[tool]}</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => {
              setError(undefined);
              void query.refetch();
            }}
          >
            {t("common.refresh")}
          </Button>
          <Button
            variant="outline"
            disabled={!query.data?.canRestore || mutation.isPending}
            onClick={() =>
              setConfirm({ kind: "restore", revision: query.data!.revision })
            }
          >
            {t("nativeTools.restore")}
          </Button>
          <Button
            disabled={!query.data || !!query.error || mutation.isPending}
            onClick={() => {
              setError(undefined);
              setEditor({
                id: "",
                config: JSON.stringify(nativeToolTemplate(tool), null, 2),
                existing: false,
                revision: query.data!.revision,
              });
            }}
          >
            {t("common.add")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          tool === "grokbuild"
            ? "nativeTools.grokHint"
            : "nativeTools.additiveHint",
        )}
      </p>
      {query.data && (
        <p className="break-all text-xs text-muted-foreground">
          {query.data.path}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {query.error ? (
        <WorkspaceQueryError onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : Object.entries(query.data?.providers ?? {}).length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">
          {t("nativeTools.empty")}
        </p>
      ) : (
        Object.entries(query.data!.providers).map(([id, config]) => (
          <div
            key={id}
            id={`native-provider-${tool}-${id}`}
            data-account-located={located === id || undefined}
            className={cn(
              "rounded-xl border bg-card p-3 flex flex-wrap items-center gap-3",
              query.data!.current === id
                ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/30"
                : "border-border",
              located === id &&
                "ring-1 ring-blue-400/50 bg-blue-50/40 dark:bg-blue-950/20",
            )}
          >
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium break-words">
                {nativeProviderName(config) ?? id}
              </h3>
              {nativeProviderName(config) && (
                <p className="text-xs text-muted-foreground break-all">{id}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {query.data!.current === id
                  ? t("provider.inUse")
                  : t("nativeTools.configured")}
              </p>
            </div>
            {tool === "grokbuild" && (
              <Button
                size="sm"
                variant="outline"
                disabled={mutation.isPending || query.data!.current === id}
                onClick={() =>
                  mutation.mutate({
                    revision: query.data!.revision,
                    id,
                    config,
                    select: true,
                  })
                }
              >
                {t("provider.enable")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                setError(undefined);
                setEditor({
                  id,
                  config: JSON.stringify(config, null, 2),
                  existing: true,
                  revision: query.data!.revision,
                });
              }}
            >
              {t("common.edit")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() =>
                setConfirm({
                  kind: "delete",
                  id,
                  revision: query.data!.revision,
                })
              }
            >
              {t("common.delete")}
            </Button>
          </div>
        ))
      )}
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) {
            setEditor(null);
            setError(undefined);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("nativeTools.editTitle", { name: nativeToolNames[tool] })}
            </DialogTitle>
            <DialogDescription>{t("nativeTools.editorHint")}</DialogDescription>
          </DialogHeader>
          <div className="p-5 flex flex-col gap-3 min-h-0 overflow-y-auto">
            <label className="text-sm">
              {t("nativeTools.id")}
              <Input
                value={editor?.id ?? ""}
                disabled={editor?.existing || mutation.isPending}
                onChange={(e) =>
                  setEditor(
                    (value) => value && { ...value, id: e.target.value },
                  )
                }
              />
            </label>
            <label className="text-sm">
              {t("nativeTools.config")}
              <textarea
                className="mt-1 block w-full rounded-md border border-border bg-background p-3 font-mono text-xs min-h-[300px]"
                spellCheck={false}
                value={editor?.config ?? ""}
                disabled={mutation.isPending}
                onChange={(e) =>
                  setEditor(
                    (value) => value && { ...value, config: e.target.value },
                  )
                }
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setEditor(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={mutation.isPending} onClick={save}>
                {t(mutation.isPending ? "common.saving" : "common.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        isOpen={confirm !== null}
        title={t(
          confirm?.kind === "restore" ? "nativeTools.restore" : "common.delete",
        )}
        message={t(
          confirm?.kind === "restore"
            ? "nativeTools.restoreHint"
            : "nativeTools.deleteHint",
        )}
        onCancel={() => {
          if (!mutation.isPending) setConfirm(null);
        }}
        onConfirm={() => {
          if (mutation.isPending || !query.data || !confirm) return;
          mutation.mutate(
            confirm.kind === "restore"
              ? "restore"
              : { revision: confirm.revision, id: confirm.id!, config: null },
          );
        }}
      />
    </div>
  );
}
