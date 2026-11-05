/**
 * 爆款MV生成器 - 主容器
 *
 * 工作流：创意+音乐 → AI分镜 → 批量视频生成
 */

import React, { useCallback, useMemo } from 'react';
import type { MVRecord, PageId } from './types';
import { loadRecords } from './storage';
import { AnalyzePage } from './pages/AnalyzePage';
import { ScriptPage } from './pages/ScriptPage';
import { GeneratePage } from './pages/GeneratePage';
import { HistoryPage } from './pages/HistoryPage';
import {
  isMVCreatorTask,
  syncMVStoryboardTask,
  syncMVRewriteTask,
  getMVMusicRecordId,
  syncMVMusicTask,
} from './task-sync';
import type { Task } from '../../types/task.types';
import {
  WorkflowNavBar,
  useWorkflowNavigation,
  useWorkflowRecords,
  type WorkflowStepConfig,
} from '../shared/workflow';
import { useWorkflowTaskSync } from '../shared/workflow/useWorkflowTaskSync';
import '../video-analyzer/VideoAnalyzer.scss';
import '../music-analyzer/MusicAnalyzer.scss';
import './MVCreator.scss';

type WorkflowPageId = Exclude<PageId, 'history'>;

const MV_STEPS: Array<Omit<WorkflowStepConfig<WorkflowPageId>, 'disabled'>> = [
  { id: 'analyze', label: '分析' },
  { id: 'script', label: '脚本' },
  { id: 'generate', label: '生成' },
];

const MVCreator: React.FC = () => {
  const {
    records,
    setRecords,
    currentRecord,
    showStarred,
    setShowStarred,
    starredCount,
    selectRecord,
    updateCurrentRecord,
    restart,
    applySyncedRecord,
  } = useWorkflowRecords<MVRecord>({
    loadRecords,
    logPrefix: '[MVCreator]',
  });
  const {
    page,
    setPage,
    navigateToStep,
    goToDefaultPage,
    openHistory,
    openStarred,
    toggleStarred,
  } = useWorkflowNavigation<PageId, WorkflowPageId>({
    initialPage: 'analyze',
    defaultPage: 'analyze',
    historyPage: 'history',
    setShowStarred,
  });

  const syncTask = useCallback(async (task: Task) => {
    if (isMVCreatorTask(task)) {
      return (await syncMVStoryboardTask(task)) || syncMVRewriteTask(task);
    }

    const recordId = getMVMusicRecordId(task);
    if (recordId) {
      return syncMVMusicTask(task, recordId);
    }

    return null;
  }, []);

  useWorkflowTaskSync<MVRecord>({
    syncTask,
    applySyncedRecord,
    logPrefix: '[MVCreator]',
  });

  const handleComplete = useCallback((record: MVRecord) => {
    updateCurrentRecord(record);
  }, [updateCurrentRecord]);

  const handleHistorySelect = useCallback((record: MVRecord) => {
    selectRecord(record);
    if (record.editedShots && record.editedShots.length > 0) {
      setPage('generate');
    } else if (record.selectedClipId) {
      setPage('analyze');
    } else {
      setPage('analyze');
    }
  }, [selectRecord, setPage]);

  const handleRecordUpdate = useCallback((record: MVRecord) => {
    updateCurrentRecord(record);
  }, [updateCurrentRecord]);

  const handleRestart = useCallback(() => {
    restart();
    goToDefaultPage();
  }, [goToDefaultPage, restart]);

  const hasShots = !!(currentRecord?.editedShots && currentRecord.editedShots.length > 0);
  const steps = useMemo<WorkflowStepConfig<WorkflowPageId>[]>(
    () =>
      MV_STEPS.map((step, index) => ({
        ...step,
        disabled: (!currentRecord && index > 0) || ((step.id === 'script' || step.id === 'generate') && !hasShots),
      })),
    [currentRecord, hasShots]
  );

  return (
    <div className="video-analyzer music-analyzer mv-creator">
      <WorkflowNavBar
        isHistoryPage={page === 'history'}
        showStarred={showStarred}
        recordsCount={records.length}
        starredCount={starredCount}
        currentStep={page}
        steps={steps}
        onStepNavigate={navigateToStep}
        onBackFromHistory={goToDefaultPage}
        onOpenHistory={openHistory}
        onOpenStarred={openStarred}
        onToggleStarred={toggleStarred}
      />

      {page === 'analyze' && (
        <AnalyzePage
          existingRecord={currentRecord}
          onComplete={handleComplete}
          onRecordsChange={setRecords}
          onCreateNew={handleRestart}
          onNext={currentRecord?.editedShots?.length ? () => setPage('script') : undefined}
        />
      )}
      {page === 'script' && currentRecord && hasShots && (
        <ScriptPage
          record={currentRecord}
          onRecordUpdate={handleRecordUpdate}
          onRecordsChange={setRecords}
          onNext={() => setPage('generate')}
        />
      )}
      {page === 'generate' && currentRecord && hasShots && (
        <GeneratePage
          record={currentRecord}
          onRecordUpdate={handleRecordUpdate}
          onRecordsChange={setRecords}
          onRestart={handleRestart}
        />
      )}
      {page === 'history' && (
        <HistoryPage
          records={records}
          onSelect={handleHistorySelect}
          onRecordsChange={setRecords}
          showStarredOnly={showStarred}
        />
      )}
    </div>
  );
};

export default MVCreator;
