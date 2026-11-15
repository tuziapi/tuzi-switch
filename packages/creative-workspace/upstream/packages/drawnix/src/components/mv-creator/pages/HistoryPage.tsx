/**
 * MV 历史记录页
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { MVRecord } from '../types';
import { deleteRecord, updateRecord } from '../storage';
import { useSharedTaskState } from '../../../hooks/useTaskQueue';
import type { Task } from '../../../types/task.types';
import { TaskStatus, TaskType } from '../../../types/task.types';
import { ConfirmDialog } from '../../dialog/ConfirmDialog';
import {
  HoverTip,
  appendTaskToRelatedGroup,
  findRecordIdFromBatch,
  sortRelatedTaskGroups,
} from '../../shared';

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.COMPLETED: return '已完成';
    case TaskStatus.PROCESSING: return '进行中';
    case TaskStatus.PENDING: return '等待中';
    case TaskStatus.FAILED: return '失败';
    default: return '';
  }
}

function statusClass(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.COMPLETED: return 'completed';
    case TaskStatus.PROCESSING: return 'processing';
    case TaskStatus.PENDING: return 'pending';
    case TaskStatus.FAILED: return 'failed';
    default: return 'pending';
  }
}

function shortTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function recordSummary(record: MVRecord): string {
  const brief = record.creativeBrief;
  return (
    brief?.purpose ||
    brief?.directorStyle ||
    brief?.narrativeStyle ||
    record.videoStyle ||
    record.musicStyleTags?.filter(Boolean).join(' / ') ||
    '暂无概要'
  );
}

interface RelatedTasks {
  storyboard: Task[];
  music: Task[];
  video: Task[];
  image: Task[];
}

interface HistoryPageProps {
  records: MVRecord[];
  onSelect: (record: MVRecord) => void;
  onRecordsChange: (records: MVRecord[]) => void;
  showStarredOnly?: boolean;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({
  records,
  onSelect,
  onRecordsChange,
  showStarredOnly = false,
}) => {
  const filtered = showStarredOnly ? records.filter(r => r.starred) : records;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { tasks: allTasks } = useSharedTaskState();

  const relatedTasksMap = useMemo(() => {
    const map = new Map<string, RelatedTasks>();
    const recordIds = new Set(records.map(r => r.id));
    const createEmptyGroups = (): RelatedTasks => ({
      storyboard: [],
      music: [],
      video: [],
      image: [],
    });

    for (const task of allTasks) {
      const params = task.params;

      // 分镜规划任务
      if (
        task.type === TaskType.CHAT &&
        params.mvCreatorAction === 'storyboard' &&
        typeof params.mvCreatorRecordId === 'string' &&
        recordIds.has(params.mvCreatorRecordId)
      ) {
        const rid = params.mvCreatorRecordId as string;
        appendTaskToRelatedGroup(map, rid, 'storyboard', task, createEmptyGroups);
        continue;
      }

      // 音乐/视频/图片任务（batchId 以 mv_ 开头）
      const batchId = typeof params.batchId === 'string' ? params.batchId : '';
      if (!batchId.startsWith('mv_')) continue;

      const rid = findRecordIdFromBatch(batchId, 'mv_', recordIds);
      if (!rid) {
        continue;
      }

      if (task.type === TaskType.AUDIO) {
        appendTaskToRelatedGroup(map, rid, 'music', task, createEmptyGroups);
      } else if (task.type === TaskType.VIDEO) {
        appendTaskToRelatedGroup(map, rid, 'video', task, createEmptyGroups);
      } else if (task.type === TaskType.IMAGE) {
        appendTaskToRelatedGroup(map, rid, 'image', task, createEmptyGroups);
      }
    }

    return sortRelatedTaskGroups(map);
  }, [allTasks, records]);

  const handleToggleStar = useCallback(
    async (e: React.MouseEvent, record: MVRecord) => {
      e.stopPropagation();
      const updated = await updateRecord(record.id, { starred: !record.starred });
      onRecordsChange(updated);
    },
    [onRecordsChange]
  );

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    const updated = await deleteRecord(pendingDeleteId);
    onRecordsChange(updated);
    setPendingDeleteId(null);
  }, [onRecordsChange, pendingDeleteId]);

  const handleToggleExpand = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExpandedId(prev => (prev === id ? null : id));
  }, []);

  if (filtered.length === 0) {
    return (
      <div className="va-page va-empty">
        <span>{showStarredOnly ? '暂无收藏' : '暂无 MV 记录'}</span>
      </div>
    );
  }

  return (
    <>
      <div className="va-page">
        <div className="va-history-list">
          {filtered.map(record => {
            const related = relatedTasksMap.get(record.id);
            const totalRelated = related
              ? related.storyboard.length + related.music.length + related.video.length + related.image.length
              : 0;
            const isExpanded = expandedId === record.id;

            return (
              <div key={record.id} className="va-history-item" onClick={() => onSelect(record)}>
                <div className="va-history-header">
                  <span className="va-history-source">
                    <span role="img" aria-label="mv">🎬</span>{' '}
                    {record.sourceLabel}
                  </span>
                  <button
                    className={`va-star-btn ${record.starred ? 'starred' : ''}`}
                    onClick={e => handleToggleStar(e, record)}
                  >
                    {record.starred ? '★' : '☆'}
                  </button>
                </div>
                <div className="va-history-meta">
                  {totalRelated > 0 && (
                    <button
                      className={`va-history-expand-btn ${isExpanded ? 'expanded' : ''}`}
                      onClick={e => handleToggleExpand(e, record.id)}
                    >
                      <ChevronRight size={12} />
                      <span>{isExpanded ? '收起' : '关联任务'}</span>
                    </button>
                  )}
                  <span>{new Date(record.createdAt).toLocaleString()}</span>
                  <button
                    className="va-history-delete"
                    onClick={e => handleDelete(e, record.id)}
                  >
                    删除
                  </button>
                </div>
                <div className="ma-history-title">{record.musicTitle || '未命名 MV'}</div>
                <div className="ma-history-summary">
                  {recordSummary(record).slice(0, 80)}
                </div>
                {record.generatedClips && record.generatedClips.length > 0 && (
                  <div className="ma-history-clips-count">
                    {record.generatedClips.length} 首音乐
                    {record.editedShots ? ` · ${record.editedShots.length} 个镜头` : ''}
                  </div>
                )}
                {isExpanded && related && (
                  <div className="va-history-related" onClick={e => e.stopPropagation()}>
                    {related.music.length > 0 && (
                      <div>
                        <div className="va-history-related-group-title">
                          音乐生成 ({related.music.length})
                        </div>
                        {related.music.map(task => (
                          <RelatedTaskItem key={task.id} task={task} />
                        ))}
                      </div>
                    )}
                    {related.storyboard.length > 0 && (
                      <div>
                        <div className="va-history-related-group-title">
                          分镜规划 ({related.storyboard.length})
                        </div>
                        {related.storyboard.map(task => (
                          <RelatedTaskItem key={task.id} task={task} />
                        ))}
                      </div>
                    )}
                    {related.video.length > 0 && (
                      <div>
                        <div className="va-history-related-group-title">
                          视频生成 ({related.video.length})
                        </div>
                        {related.video.map(task => (
                          <RelatedTaskItem key={task.id} task={task} />
                        ))}
                      </div>
                    )}
                    {related.image.length > 0 && (
                      <div>
                        <div className="va-history-related-group-title">
                          图片生成 ({related.image.length})
                        </div>
                        {related.image.map(task => (
                          <RelatedTaskItem key={task.id} task={task} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="确认删除"
        description="确定要删除这条 MV 记录吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        danger
        onOpenChange={open => { if (!open) setPendingDeleteId(null); }}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
};

const RelatedTaskItem: React.FC<{ task: Task }> = ({ task }) => (
  <HoverTip content={statusLabel(task.status)} showArrow={false}>
    <div className="va-history-related-task">
      <span
        className={`va-history-related-task-status ${statusClass(task.status)}`}
      />
      <span className="va-history-related-task-prompt">
        {String(task.params.prompt || '').slice(0, 40) || task.id.slice(0, 8)}
      </span>
      <span className="va-history-related-task-time">
        {shortTime(task.createdAt)}
      </span>
    </div>
  </HoverTip>
);
