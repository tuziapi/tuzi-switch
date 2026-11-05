/**
 * 视频拆解器 - 主容器
 *
 * 多步骤工作流：分析 → 脚本编辑 → 素材生成
 * 支持历史记录和收藏
 */

import React, { useCallback, useMemo } from 'react';
import type { PageId, AnalysisRecord } from './types';
import { loadRecords, updateRecord } from './storage';
import { AnalyzePage } from './pages/AnalyzePage';
import { ScriptPage } from './pages/ScriptPage';
import { GeneratePage } from './pages/GeneratePage';
import { HistoryPage } from './pages/HistoryPage';
import { syncVideoAnalyzerTask, isVideoAnalyzerTask } from './task-sync';
import { switchToVersion } from './utils';
import { useDrawnix } from '../../hooks/use-drawnix';
import { insertImageFromUrl } from '../../data/image';
import { insertVideoFromUrl } from '../../data/video';
import { TaskType } from '../../types/task.types';
import type { Task } from '../../types/task.types';
import { MessagePlugin } from '../../utils/message-plugin';
import {
  WorkflowNavBar,
  useWorkflowNavigation,
  useWorkflowRecords,
  type WorkflowStepConfig,
} from '../shared/workflow';
import { useWorkflowTaskSync } from '../shared/workflow/useWorkflowTaskSync';
import './VideoAnalyzer.scss';

type WorkflowPageId = Exclude<PageId, 'history'>;

const VIDEO_STEPS: Array<Omit<WorkflowStepConfig<WorkflowPageId>, 'disabled'>> = [
  { id: 'analyze', label: '分析' },
  { id: 'script', label: '脚本' },
  { id: 'generate', label: '生成' },
];

const VideoAnalyzer: React.FC = () => {
  const { board } = useDrawnix();
  const {
    records,
    setRecords,
    currentRecord,
    setCurrentRecord,
    showStarred,
    setShowStarred,
    starredCount,
    selectRecord,
    updateCurrentRecord,
    restart,
    applySyncedRecord,
  } = useWorkflowRecords<AnalysisRecord>({
    loadRecords,
    logPrefix: '[VideoAnalyzer]',
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
    if (!isVideoAnalyzerTask(task)) {
      return null;
    }
    return syncVideoAnalyzerTask(task);
  }, []);

  useWorkflowTaskSync<AnalysisRecord>({
    syncTask,
    applySyncedRecord,
    logPrefix: '[VideoAnalyzer]',
  });

  const steps = useMemo<WorkflowStepConfig<WorkflowPageId>[]>(
    () =>
      VIDEO_STEPS.map((step, index) => ({
        ...step,
        disabled: !currentRecord && index > 0,
      })),
    [currentRecord]
  );

  const handleAnalysisComplete = useCallback((record: AnalysisRecord) => {
    updateCurrentRecord(record);
  }, [updateCurrentRecord]);

  const handleHistorySelect = useCallback((record: AnalysisRecord) => {
    selectRecord(record);
    goToDefaultPage();
  }, [goToDefaultPage, selectRecord]);

  const handleRecordUpdate = useCallback((record: AnalysisRecord) => {
    updateCurrentRecord(record);
  }, [updateCurrentRecord]);

  const handleRestart = useCallback(() => {
    restart();
    goToDefaultPage();
  }, [goToDefaultPage, restart]);

  const handleInsertTask = useCallback(async (task: Task) => {
    if ((!task.result?.url && !task.result?.urls?.length) || !board) {
      void MessagePlugin.warning('无法插入：白板未就绪');
      return;
    }
    try {
      if (task.type === TaskType.IMAGE) {
        const urls = task.result.urls?.length ? task.result.urls : [task.result.url];
        for (const url of urls) {
          await insertImageFromUrl(board, url);
        }
        void MessagePlugin.success(urls.length > 1 ? '多图已插入到白板' : '图片已插入到白板');
      } else if (task.type === TaskType.VIDEO) {
        await insertVideoFromUrl(board, task.result.url);
        void MessagePlugin.success('视频已插入到白板');
      }
    } catch (error) {
      console.error('[VideoAnalyzer] Failed to insert to board:', error);
      void MessagePlugin.error(`插入失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [board]);

  const handleSelectScript = useCallback(async (record: AnalysisRecord, task: Task) => {
    // 通过任务的 prompt 匹配 ScriptVersion
    const taskPrompt = String(task.params.videoAnalyzerPrompt || task.params.prompt || '');
    const versions = record.scriptVersions || [];
    const matched = versions.find(v => v.prompt === taskPrompt)
      || versions.find(v => taskPrompt && v.prompt?.includes(taskPrompt));

    let updatedRecord = record;
    if (matched && matched.id !== record.activeVersionId) {
      const patch = switchToVersion(record, matched.id);
      if (patch) {
        const updatedRecords = await updateRecord(record.id, patch);
        updatedRecord = updatedRecords.find(r => r.id === record.id) || { ...record, ...patch };
        setRecords(updatedRecords);
      }
    }

    setCurrentRecord(updatedRecord);
    setPage('script');
  }, [setCurrentRecord, setPage, setRecords]);

  return (
    <div className="video-analyzer">
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

      {/* 页面内容 */}
      {page === 'analyze' && (
        <AnalyzePage
          existingRecord={currentRecord}
          onComplete={handleAnalysisComplete}
          onRecordsChange={setRecords}
          onCreateNew={handleRestart}
          onNext={currentRecord ? () => setPage('script') : undefined}
        />
      )}
      {page === 'script' && currentRecord && (
        <ScriptPage
          record={currentRecord}
          onRecordUpdate={handleRecordUpdate}
          onRecordsChange={setRecords}
          onNext={() => setPage('generate')}
        />
      )}
      {page === 'generate' && currentRecord && (
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
          onInsertTask={board ? handleInsertTask : undefined}
          onSelectScript={handleSelectScript}
        />
      )}
    </div>
  );
};

export default VideoAnalyzer;
