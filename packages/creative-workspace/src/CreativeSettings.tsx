import { useEffect, useState } from "react";
import { PlaitPointerType } from "@plait/core";
import {
  DrawnixContext,
  type DrawnixState,
} from "../upstream/packages/drawnix/src/hooks/use-drawnix";
import { SettingsDialog } from "../upstream/packages/drawnix/src/components/settings-dialog/settings-dialog";

/** The original settings, available on projects without mounting or creating a board. */
export function CreativeSettings({ onClose }: { onClose: () => void }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // The host portal is a sibling committed with this component. Resolving it
    // during render can return null on a cold load and mount WinBox on body.
    setContainer(document.getElementById("creative-portals"));
  }, []);
  const [appState, setAppState] = useState<DrawnixState>({
    pointer: PlaitPointerType.hand,
    isMobile: false,
    isPencilMode: false,
    openDialogTypes: new Set(),
    openCleanConfirm: false,
    openSettings: true,
  });
  useEffect(() => {
    if (!appState.openSettings) onClose();
  }, [appState.openSettings, onClose]);
  return (
    <DrawnixContext.Provider value={{ appState, setAppState, board: null }}>
      {container && <SettingsDialog container={container} />}
    </DrawnixContext.Provider>
  );
}
