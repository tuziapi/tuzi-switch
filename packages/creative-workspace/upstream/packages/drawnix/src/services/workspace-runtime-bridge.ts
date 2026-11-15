import type {
  BoardMetadata,
  WorkspaceState,
} from '../types/workspace.types';

interface WorkspaceRuntime {
  reload: () => Promise<void>;
  getState: () => WorkspaceState;
  getAllBoardMetadata: () => BoardMetadata[];
}

let workspaceRuntime: WorkspaceRuntime | null = null;

export function registerWorkspaceRuntime(runtime: WorkspaceRuntime): void {
  workspaceRuntime = runtime;
}

function getWorkspaceRuntime(): WorkspaceRuntime {
  if (!workspaceRuntime) {
    throw new Error('Workspace runtime is not registered');
  }
  return workspaceRuntime;
}

export function getWorkspaceState(): WorkspaceState {
  return getWorkspaceRuntime().getState();
}

export function getAllWorkspaceBoardMetadata(): BoardMetadata[] {
  return getWorkspaceRuntime().getAllBoardMetadata();
}

export async function reloadWorkspace(): Promise<void> {
  await getWorkspaceRuntime().reload();
}
