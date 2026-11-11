import type { ComponentType } from 'react';
import type { CreativeAccountBridge } from './bridge-types';
export type { CreativeAccountBridge, CreativeAccountBinding, CreativeAccountKey } from './bridge-types';
export type { CreativeCodexBridge, CreativeCodexModel } from './bridge-types';
export type CreativePage = 'projects' | 'canvas';
export interface CreativeWorkspaceProps {
  active?: boolean;
  page: CreativePage;
  onPageChange: (page: CreativePage) => void;
  settingsOpen?: boolean;
  onSettingsOpenChange?: (open: boolean) => void;
  accountBridge?: CreativeAccountBridge;
}
export const CreativeWorkspace: ComponentType<CreativeWorkspaceProps>;

export function prepareCreativeUpdate(): Promise<void>;
