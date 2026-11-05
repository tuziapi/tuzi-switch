import type React from 'react';
import type { ToolDefinition } from '../types/toolbox.types';

export interface ToolPluginModule {
  manifest: ToolDefinition;
  Component?: React.ComponentType<any>;
}
