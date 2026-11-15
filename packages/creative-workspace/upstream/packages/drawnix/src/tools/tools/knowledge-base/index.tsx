import React, { lazy, Suspense } from 'react';
import type { ToolPluginModule } from '../../types';
import { ToolCategory } from '../../../types/toolbox.types';
import { BookOpenIcon } from '../../../components/icons';

const KnowledgeBaseContent = lazy(
  () => import('../../../components/knowledge-base/KnowledgeBaseContent')
);

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

export const KnowledgeBaseToolComponent: React.FC<{ initialNoteId?: string | null }> = ({
  initialNoteId,
}) => {
  return (
    <div className="tool-adapter-container" style={{ width: '100%', height: '100%' }}>
      <Suspense fallback={<LoadingFallback message="加载知识库..." />}>
        <KnowledgeBaseContent initialNoteId={initialNoteId} />
      </Suspense>
    </div>
  );
};

export const knowledgeBaseTool: ToolPluginModule = {
  manifest: {
    id: 'knowledge-base',
    name: '知识库',
    description: '个人知识管理工具，支持目录分类、标签管理和 Markdown 编辑',
    icon: React.createElement(BookOpenIcon),
    category: ToolCategory.UTILITIES,
    component: 'knowledge-base',
    defaultWidth: 900,
    defaultHeight: 700,
  },
  Component: KnowledgeBaseToolComponent,
};
