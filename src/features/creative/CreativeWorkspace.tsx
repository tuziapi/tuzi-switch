import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import type { CreativePage } from "@tuzi/creative-workspace";
import { disconnectedAccount, type AccountState } from "@/lib/api/account";
import { createCreativeAccountBridge } from "./accountBridge";
import { useModelUpgradeSync } from "./useModelUpgradeSync";
import { CreativeTopBar } from "./CreativeTopBar";

import { registerUpdateGuard } from "@/lib/updateSafety";

const Workspace = lazy(async () => {
  const module = await import("@tuzi/creative-workspace");
  await import("@tuzi/creative-workspace/style.css");
  return { default: module.CreativeWorkspace };
});

class CreativeErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div role="alert" className="m-auto max-w-md p-8 text-center">
        <h2 className="font-medium">创作工作区加载失败</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          本地项目已保留。可以切回其他页面后重试。
        </p>
        <button
          className="mt-4 rounded-lg border px-4 py-2 text-sm"
          onClick={() => this.setState({ failed: false })}
        >
          重试
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

const noAccountAction = () => {};

function initialCreativePage(): CreativePage {
  const saved = sessionStorage.getItem("tuzi-creative-page");
  return saved === "canvas" ? saved : "projects";
}

export function CreativeWorkspace({
  active = true,
  accountState = disconnectedAccount,
  onManageAccount = noAccountAction,
  selectedKeyId,
  navigation,
  reserveMacControls,
  reserveWindowControls,
}: {
  active?: boolean;
  accountState?: AccountState;
  onManageAccount?: () => void;
  selectedKeyId?: string;
  navigation?: ReactNode;
  reserveMacControls?: boolean;
  reserveWindowControls?: boolean;
}) {
  const [hasOpened, setHasOpened] = useState(active);
  useEffect(() => {
    if (active) setHasOpened(true);
  }, [active]);
  useEffect(() => {
    if (!hasOpened && !active) return;
    return registerUpdateGuard(async () => {
      const module = await import("@tuzi/creative-workspace");
      await module.prepareCreativeUpdate();
    });
  }, [hasOpened, active]);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(selectedKeyId));
  const manageAccountRef = useRef(onManageAccount);
  manageAccountRef.current = onManageAccount;
  const manageAccount = useCallback(() => manageAccountRef.current(), []);
  const accountBridge = useMemo(
    () =>
      createCreativeAccountBridge(accountState, manageAccount, selectedKeyId),
    [accountState, manageAccount, selectedKeyId],
  );
  useModelUpgradeSync(accountBridge);
  useEffect(() => {
    if (selectedKeyId) setSettingsOpen(true);
  }, [selectedKeyId]);
  const [page, setPage] = useState<CreativePage>(initialCreativePage);
  useEffect(() => {
    sessionStorage.setItem("tuzi-creative-page", page);
  }, [page]);
  if (!active && !hasOpened) return null;
  return (
    <section
      hidden={!active}
      style={active ? undefined : { display: "none" }}
      aria-label="opentu 创作工作区"
      className="tuzi-creative-arrival flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <CreativeTopBar
        page={page}
        onPageChange={setPage}
        onOpenSettings={() => setSettingsOpen(true)}
        navigation={navigation}
        reserveMacControls={reserveMacControls}
        reserveWindowControls={reserveWindowControls}
      />
      <div className="relative min-h-0 flex-1">
        <CreativeErrorBoundary>
          <Suspense
            fallback={
              <div
                role="status"
                className="flex h-full items-center justify-center text-sm text-muted-foreground"
              >
                正在加载 opentu 创作…
              </div>
            }
          >
            <Workspace
              active={active}
              page={page}
              onPageChange={setPage}
              settingsOpen={settingsOpen}
              onSettingsOpenChange={setSettingsOpen}
              accountBridge={accountBridge}
            />
          </Suspense>
        </CreativeErrorBoundary>
      </div>
    </section>
  );
}
