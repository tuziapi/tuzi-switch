import React, { lazy, Suspense, type CSSProperties } from 'react';
import { Images } from 'lucide-react';
import type { ToolPluginModule } from '../../types';
import { ToolCategory } from '../../../types/toolbox.types';
import { COMIC_CREATOR_TOOL_ID } from '../../tool-ids';

const ComicCreatorOriginal = lazy(
  () => import('../../../components/comic-creator/ComicCreator')
);

const containerStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const LoadingFallback: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: 200,
      color: '#999',
      fontSize: 14,
    }}
  >
    加载中...
  </div>
);

export const ComicCreatorToolComponent: React.FC<Record<string, unknown>> = (
  props
) => (
  <div style={containerStyle}>
    <Suspense fallback={<LoadingFallback />}>
      <ComicCreatorOriginal {...props} />
    </Suspense>
  </div>
);

export const comicCreatorTool: ToolPluginModule = {
  manifest: {
    id: COMIC_CREATOR_TOOL_ID,
    name: '多图生成',
    description:
      '适合故事分镜、教程步骤、产品手册、营销图文等多页图片，一键规划提示词、批量出图并导出 ZIP/PPTX/PDF',
    icon: <Images size={18} strokeWidth={1.75} />,
    category: ToolCategory.AI_TOOLS,
    component: COMIC_CREATOR_TOOL_ID,
    supportsMultipleWindows: true,
    defaultWindowBehavior: {
      autoPinOnOpen: true,
    },
    defaultWidth: 720,
    defaultHeight: 760,
  },
  Component: ComicCreatorToolComponent,
};
