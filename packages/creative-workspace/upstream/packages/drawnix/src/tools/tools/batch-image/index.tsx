import React from 'react';
import { lazy, Suspense, type CSSProperties } from 'react';
import type { ToolPluginModule } from '../../types';
import { ToolCategory } from '../../../types/toolbox.types';
import { BatchIcon } from '../../../components/icons';

const BatchImageGenerationOriginal = lazy(
  () => import('../../../components/ttd-dialog/batch-image-generation')
);

const containerStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const LoadingFallback: React.FC<{ message?: string }> = ({ message = '加载中...' }) => (
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
    {message}
  </div>
);

const StyleOverride: React.FC = () => (
  <style>{`
    .tool-adapter-container .batch-image-generation {
      height: 100% !important;
      max-height: 100% !important;
      overflow: auto !important;
    }
  `}</style>
);

export const BatchImageToolComponent: React.FC<any> = (props) => {
  return (
    <div className="tool-adapter-container" style={containerStyle}>
      <StyleOverride />
      <Suspense fallback={<LoadingFallback />}>
        <BatchImageGenerationOriginal {...props} />
      </Suspense>
    </div>
  );
};

export const batchImageTool: ToolPluginModule = {
  manifest: {
    id: 'batch-image',
    name: '批量出图工具',
    description: 'Excel式批量AI图片生成，支持批量编辑、图片参考和历史追踪',
    icon: React.createElement(BatchIcon),
    category: ToolCategory.AI_TOOLS,
    component: 'batch-image',
    defaultWidth: 1200,
    defaultHeight: 800,
  },
  Component: BatchImageToolComponent,
};
