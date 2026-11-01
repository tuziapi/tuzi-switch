import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  FileText,
  Plus,
  RotateCcw,
  RefreshCw,
  Search,
  Pencil,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  agentsApi,
  agentTemplate,
  type AgentTool,
  type AgentChange,
} from "@/lib/api/agents";
import { WorkspaceScope } from "@/components/shell/WorkspaceScope";
import { WorkspaceQueryError } from "@/components/common/WorkspaceQueryError";
import type { WorkspaceTool } from "@/config/workspace";
import type { AppId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "./agents.css";

interface AgentsPanelProps {
  origin: WorkspaceTool;
  target: AppId | null;
  onTargetChange: (tool: AppId) => void;
}
export function AgentsPanel({
  origin,
  target,
  onTargetChange,
}: AgentsPanelProps) {
  const { t } = useTranslation();
  const tool = target === "claude" || target === "opencode" ? target : null;
  return (
    <div className="agents-page flex flex-col flex-1 min-h-0">
      <WorkspaceScope
        feature="agents"
        origin={tool ?? origin}
        target={tool}
        onTargetChange={onTargetChange}
      />
      {tool ? (
        <AgentFiles key={tool} tool={tool} />
      ) : (
        <div className="agents-empty">
          <span className="agents-empty-icon">
            <Bot className="h-7 w-7" />
          </span>
          <p>{t("navigation.chooseTarget")}</p>
        </div>
      )}
    </div>
  );
}

function AgentFiles({ tool }: { tool: AgentTool }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const queryKey = ["agents", tool];
  const query = useQuery({
    queryKey,
    queryFn: () => agentsApi.read(tool),
    retry: false,
    gcTime: 0,
  });
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{
    id: string;
    content: string;
    revision: string;
    existing: boolean;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    id?: string;
    revision: string;
    kind: "delete" | "restore";
  } | null>(null);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const mutation = useMutation({
    mutationFn: (change: AgentChange | "restore") =>
      change === "restore"
        ? agentsApi.restore(tool, confirm!.revision)
        : agentsApi.write(tool, change),
    onSuccess: (data) => {
      client.setQueryData(queryKey, data);
      setEditor(null);
      setConfirm(null);
      setError(undefined);
    },
    onError: () => setError(t("agents.failed")),
    onSettled: () => {
      pending.current = false;
    },
  });
  const run = (change: AgentChange | "restore") => {
    if (pending.current) return;
    pending.current = true;
    mutation.mutate(change);
  };
  const ready = !!query.data && !query.error && !mutation.isPending;
  const save = () => {
    if (!editor || mutation.isPending) return;
    const id = editor.id.trim();
    if (
      !id ||
      !id.endsWith(".md") ||
      (!editor.existing && query.data?.files.some((file) => file.id === id))
    ) {
      setError(t("agents.filenameInvalid"));
      return;
    }
    if (!editor.content.trim()) {
      setError(t("agents.contentRequired"));
      return;
    }
    run({ id, content: editor.content, revision: editor.revision });
  };
  const files = (query.data?.files ?? []).filter((file) =>
    file.id.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className="agents-files flex flex-col flex-1 min-h-0 gap-4">
      <div className="agents-controls">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-medium">{t("agents.library")}</span>
            {query.data && !query.error && (
              <span className="agents-count">{query.data.files.length}</span>
            )}
          </div>
          <span className="agents-scope-badge">{t("agents.userScope")}</span>
        </div>
        <div className="agents-toolbar flex flex-wrap gap-2 items-center">
          <div className="agents-search relative flex-1 min-w-[160px]">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input
              aria-label={t("agents.search")}
              placeholder={t("agents.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-full border-transparent bg-muted/50 shadow-none focus-visible:bg-background"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full shrink-0 bg-muted/50"
            aria-label={t("common.refresh")}
            title={t("common.refresh")}
            disabled={mutation.isPending}
            onClick={() => {
              setError(undefined);
              void query.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="rounded-full border-border/70 shadow-none"
            disabled={!ready || !query.data?.canRestore}
            onClick={() => {
              setError(undefined);
              setConfirm({ kind: "restore", revision: query.data!.revision });
            }}
          >
            <RotateCcw className="h-4 w-4" />
            {t("agents.restore")}
          </Button>
          <Button
            className="rounded-full px-4 shadow-none"
            disabled={!ready}
            onClick={() => {
              setError(undefined);
              setEditor({
                id: "",
                content: agentTemplate(tool),
                revision: query.data!.revision,
                existing: false,
              });
            }}
          >
            <Plus className="h-4 w-4" />
            {t("agents.add")}
          </Button>
        </div>
        <details className="agents-help">
          <summary>
            <span>{t("agents.help")}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </summary>
          <div className="space-y-2 pt-2">
            <p>{t("agents.scope")}</p>
            {query.data && (
              <p className="break-all font-mono text-[11px]">
                {query.data.path}
              </p>
            )}
          </div>
        </details>
      </div>
      {error && !editor && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {query.error ? (
        <WorkspaceQueryError onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : (
        <div className="agents-list flex-1 min-h-0 overflow-y-auto space-y-2.5 pb-6">
          {files.length === 0 ? (
            <div className="agents-empty">
              <span className="agents-empty-icon">
                <Bot className="h-7 w-7" />
              </span>
              <p>{t(search ? "agents.noMatch" : "agents.empty")}</p>
            </div>
          ) : (
            files.map((file) => (
              <div
                key={file.id}
                className="agents-file-row flex flex-wrap items-center gap-3"
              >
                <span className="agents-file-icon">
                  <FileText className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium break-all">{file.id}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t(
                      file.validationError
                        ? "agents.invalidFile"
                        : "agents.nativeFile",
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full border-border/70 px-3.5"
                  disabled={!ready}
                  onClick={() => {
                    setError(undefined);
                    setEditor({
                      ...file,
                      revision: query.data!.revision,
                      existing: true,
                    });
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t("common.edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full hover:text-destructive"
                  aria-label={t("common.delete")}
                  title={t("common.delete")}
                  disabled={!ready}
                  onClick={() => {
                    setError(undefined);
                    setConfirm({
                      kind: "delete",
                      id: file.id,
                      revision: query.data!.revision,
                    });
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
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
        <DialogContent
          className="agents-editor max-w-3xl max-h-[85vh] flex flex-col rounded-3xl sm:rounded-3xl overflow-y-auto"
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (mutation.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(editor?.existing ? "agents.edit" : "agents.add")}
            </DialogTitle>
            <DialogDescription>{t("agents.editorHint")}</DialogDescription>
          </DialogHeader>
          {editor && (
            <>
              <label className="space-y-2 text-sm px-6 pt-5">
                {t("agents.filename")}
                <Input
                  aria-label={t("agents.filename")}
                  value={editor.id}
                  disabled={editor.existing || mutation.isPending}
                  onChange={(e) => setEditor({ ...editor, id: e.target.value })}
                  placeholder="code-reviewer.md"
                  className="rounded-xl shadow-none"
                />
              </label>
              <label className="flex flex-col gap-2 min-h-0 flex-1 text-sm px-6 pt-4">
                {t("agents.content")}
                <Textarea
                  aria-label={t("agents.content")}
                  className="font-mono text-xs leading-relaxed min-h-[180px] flex-1 resize-none rounded-2xl bg-muted/20 shadow-none p-4"
                  value={editor.content}
                  disabled={mutation.isPending}
                  onChange={(e) =>
                    setEditor({ ...editor, content: e.target.value })
                  }
                />
              </label>
              {error && (
                <p role="alert" className="px-6 pt-3 text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 shrink-0 px-6 py-5">
                <Button
                  variant="outline"
                  className="rounded-full px-5"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setEditor(null);
                    setError(undefined);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  className="rounded-full px-5"
                  disabled={mutation.isPending}
                  onClick={save}
                >
                  {t(mutation.isPending ? "common.saving" : "common.save")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        isOpen={!!confirm}
        title={t(
          confirm?.kind === "delete" ? "agents.deleteTitle" : "agents.restore",
        )}
        message={
          t(
            confirm?.kind === "delete"
              ? "agents.deleteHint"
              : "agents.restoreHint",
            { id: confirm?.id },
          ) + (error ? `\n\n${error}` : "")
        }
        variant={confirm?.kind === "delete" ? "destructive" : "info"}
        onCancel={() => {
          if (!mutation.isPending) setConfirm(null);
        }}
        onConfirm={() => {
          if (confirm && !mutation.isPending)
            run(
              confirm.kind === "restore"
                ? "restore"
                : {
                    id: confirm.id!,
                    content: null,
                    revision: confirm.revision,
                  },
            );
        }}
      />
    </div>
  );
}
