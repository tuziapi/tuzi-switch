import React from 'react';
import { History, Star } from 'lucide-react';
import { WorkflowStepBar, type WorkflowStepConfig } from './WorkflowStepBar';

export interface WorkflowNavBarProps<TStepId extends string> {
  isHistoryPage: boolean;
  showStarred: boolean;
  recordsCount: number;
  starredCount: number;
  currentStep: string;
  steps: readonly WorkflowStepConfig<TStepId>[];
  onStepNavigate: (step: TStepId) => void;
  onBackFromHistory: () => void;
  onOpenHistory: () => void;
  onOpenStarred: () => void;
  onToggleStarred: () => void;
}

export function WorkflowNavBar<TStepId extends string>({
  isHistoryPage,
  showStarred,
  recordsCount,
  starredCount,
  currentStep,
  steps,
  onStepNavigate,
  onBackFromHistory,
  onOpenHistory,
  onOpenStarred,
  onToggleStarred,
}: WorkflowNavBarProps<TStepId>): React.ReactElement {
  return (
    <div className="va-nav">
      {isHistoryPage ? (
        <>
          <button className="va-nav-back" onClick={onBackFromHistory}>
            ←
          </button>
          <span className="va-nav-title">
            {showStarred ? '收藏' : '历史记录'}
          </span>
          <button
            className={`va-nav-btn ${showStarred ? 'active' : ''}`}
            onClick={onToggleStarred}
          >
            {showStarred ? '★ 收藏' : '☆ 全部'}
          </button>
        </>
      ) : (
        <>
          <WorkflowStepBar
            current={currentStep}
            onNavigate={onStepNavigate}
            steps={steps}
          />
          <div className="va-nav-actions">
            <button
              className={`va-nav-btn va-nav-btn--history ${
                recordsCount > 0 ? 'has-count' : ''
              }`}
              onClick={onOpenHistory}
              aria-label="history"
              title="历史"
            >
              <History size={17} strokeWidth={2.2} aria-hidden="true" />
              {recordsCount > 0 && (
                <span className="va-nav-count">{recordsCount}</span>
              )}
            </button>
            <button
              className={`va-nav-btn va-nav-btn--starred ${
                starredCount > 0 ? 'has-count' : ''
              }`}
              onClick={onOpenStarred}
              aria-label="starred"
              title="收藏"
            >
              <Star
                size={17}
                strokeWidth={2.2}
                fill={starredCount > 0 ? 'currentColor' : 'none'}
                aria-hidden="true"
              />
              {starredCount > 0 && (
                <span className="va-nav-count">{starredCount}</span>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
