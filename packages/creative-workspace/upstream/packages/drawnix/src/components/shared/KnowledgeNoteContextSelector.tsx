import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import classNames from 'classnames';
import type { KnowledgeContextRef } from '../../types/task.types';
import type { KBDirectory, KBNoteMeta } from '../../types/knowledge-base.types';
import { knowledgeBaseService } from '../../services/knowledge-base-service';
import {
  createKnowledgeContextRefFromMeta,
  MAX_KNOWLEDGE_CONTEXT_NOTES,
  normalizeKnowledgeContextRefs,
} from '../../services/generation-context-service';
import { Z_INDEX } from '../../constants/z-index';
import './knowledge-note-context-selector.scss';

export interface KnowledgeNoteContextSelectorProps {
  value: KnowledgeContextRef[];
  onChange: (refs: KnowledgeContextRef[]) => void;
  disabled?: boolean;
  label?: string;
  language?: 'zh' | 'en';
  maxNotes?: number;
  className?: string;
  variant?: 'default' | 'compact';
  placement?: 'down' | 'up';
}

export function normalizeKnowledgeNoteSearch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').trim();
}

export function filterKnowledgeNoteMetas(
  notes: KBNoteMeta[],
  directories: KBDirectory[],
  query: string
): KBNoteMeta[] {
  const normalizedQuery = normalizeKnowledgeNoteSearch(query);
  if (!normalizedQuery) {
    return notes;
  }
  const directoryNameMap = new Map(directories.map((dir) => [dir.id, dir.name]));
  return notes.filter((note) => {
    const haystack = normalizeKnowledgeNoteSearch(
      [
        note.title,
        note.metadata?.description,
        note.metadata?.domain,
        note.metadata?.sourceUrl,
        directoryNameMap.get(note.directoryId),
        ...(note.metadata?.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
    );
    return haystack.includes(normalizedQuery);
  });
}

export function isKnowledgeNoteOptionDisabled(
  noteId: string,
  selectedNoteIds: string[],
  maxNotes: number
): boolean {
  return !selectedNoteIds.includes(noteId) && selectedNoteIds.length >= maxNotes;
}

export function getKnowledgeNoteContextCompactState(
  selectedRefs: KnowledgeContextRef[],
  language: 'zh' | 'en' = 'zh'
): {
  triggerLabel: string;
  selectedTitleText: string;
  hoverTitle: string;
  noteTitles: string[];
  shouldShowChips: boolean;
  canClear: boolean;
  clearLabel: string;
  clearAriaLabel: string;
  addNoteLabel: string;
  addNoteAriaLabel: string;
  badgeText?: string;
} {
  const noteTitles = selectedRefs.map((ref) => ref.title || '未命名笔记');
  const selectedTitleText = noteTitles.join('、');
  const hasSelection = selectedRefs.length > 0;
  return {
    triggerLabel: hasSelection
      ? language === 'zh'
        ? `知识库上下文，已选 ${selectedRefs.length} 篇笔记`
        : `Knowledge context, ${selectedRefs.length} notes selected`
      : language === 'zh'
        ? '选择知识库笔记'
        : 'Select knowledge notes',
    selectedTitleText,
    hoverTitle: language === 'zh' ? '已选知识库笔记' : 'Selected notes',
    noteTitles,
    shouldShowChips: false,
    canClear: hasSelection,
    clearLabel: language === 'zh' ? '清除' : 'Clear',
    clearAriaLabel:
      language === 'zh' ? '清除已选知识库笔记' : 'Clear selected knowledge notes',
    addNoteLabel: language === 'zh' ? '添加笔记' : 'Add note',
    addNoteAriaLabel:
      language === 'zh' ? '打开知识库新建笔记' : 'Open knowledge base to add note',
    badgeText: hasSelection ? String(selectedRefs.length) : undefined,
  };
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '';
  }
}

export const KnowledgeNoteContextSelector: React.FC<
  KnowledgeNoteContextSelectorProps
> = ({
  value,
  onChange,
  disabled = false,
  label,
  language = 'zh',
  maxNotes = MAX_KNOWLEDGE_CONTEXT_NOTES,
  className = '',
  variant = 'default',
  placement = 'down',
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<KBNoteMeta[]>([]);
  const [directories, setDirectories] = useState<KBDirectory[]>([]);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [compactDropdownStyle, setCompactDropdownStyle] =
    useState<React.CSSProperties>({});

  const selectedRefs = useMemo(
    () => normalizeKnowledgeContextRefs(value, maxNotes),
    [maxNotes, value]
  );
  const selectedIdSet = useMemo(
    () => new Set(selectedRefs.map((ref) => ref.noteId)),
    [selectedRefs]
  );
  const directoryNameMap = useMemo(
    () => new Map(directories.map((dir) => [dir.id, dir.name])),
    [directories]
  );

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      await knowledgeBaseService.initialize();
      const [nextNotes, nextDirectories] = await Promise.all([
        knowledgeBaseService.getAllNoteMetas(),
        knowledgeBaseService.getAllDirectories(),
      ]);
      setNotes(
        [...nextNotes].sort((left, right) => right.updatedAt - left.updatedAt)
      );
      setDirectories(nextDirectories);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadNotes();
  }, [loadNotes, open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open || variant !== 'compact' || !containerRef.current) return;

    const updatePosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, Math.max(240, window.innerWidth - 32));
      const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
      setCompactDropdownStyle({
        position: 'fixed',
        top: 'auto',
        bottom: window.innerHeight - rect.top + 8,
        left,
        width,
        zIndex: Z_INDEX.DROPDOWN_PORTAL,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, variant]);

  const filteredNotes = useMemo(() => {
    return filterKnowledgeNoteMetas(notes, directories, query);
  }, [directories, notes, query]);

  const toggleNote = useCallback(
    (note: KBNoteMeta) => {
      const exists = selectedIdSet.has(note.id);
      const nextRefs = exists
        ? selectedRefs.filter((ref) => ref.noteId !== note.id)
        : [...selectedRefs, createKnowledgeContextRefFromMeta(note)];
      onChange(normalizeKnowledgeContextRefs(nextRefs, maxNotes));
    },
    [maxNotes, onChange, selectedIdSet, selectedRefs]
  );

  const removeNote = useCallback(
    (noteId: string) => {
      onChange(selectedRefs.filter((ref) => ref.noteId !== noteId));
    },
    [onChange, selectedRefs]
  );
  const clearSelectedNotes = useCallback(
    (event?: React.MouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation();
      onChange([]);
    },
    [onChange]
  );
  const openCreateKnowledgeNote = useCallback(
    (event?: React.MouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation();
      if (disabled || typeof window === 'undefined') {
        return;
      }

      const navigationDetail = {
        directoryName: '笔记',
        autoCreateNote: true,
      };
      (window as any).__kbPendingNavigation = navigationDetail;
      window.dispatchEvent(new CustomEvent('kb:open', { detail: {} }));
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('kb:navigate', {
            detail: navigationDetail,
          })
        );
      }, 300);
      setOpen(false);
    },
    [disabled]
  );

  const labelText =
    label || (language === 'zh' ? '知识库上下文' : 'Knowledge Context');
  const placeholder =
    language === 'zh' ? '搜索知识库笔记...' : 'Search notes...';
  const emptyText =
    language === 'zh' ? '暂无可选笔记' : 'No notes available';
  const noMatchText = language === 'zh' ? '无匹配笔记' : 'No matching notes';
  const isCompact = variant === 'compact';
  const compactState = getKnowledgeNoteContextCompactState(
    selectedRefs,
    language
  );

  const dropdown = open ? (
    <div
      ref={dropdownRef}
      className="knowledge-note-context-selector__dropdown"
      style={isCompact ? compactDropdownStyle : undefined}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="knowledge-note-context-selector__search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          autoFocus
        />
      </div>

      <div className="knowledge-note-context-selector__list">
        {loading ? (
          <div className="knowledge-note-context-selector__empty">
            {language === 'zh' ? '加载中...' : 'Loading...'}
          </div>
        ) : filteredNotes.length > 0 ? (
          filteredNotes.map((note) => {
            const selected = selectedIdSet.has(note.id);
            const disabledItem = isKnowledgeNoteOptionDisabled(
              note.id,
              selectedRefs.map((ref) => ref.noteId),
              maxNotes
            );
            const dirName = directoryNameMap.get(note.directoryId);
            return (
              <button
                key={note.id}
                type="button"
                className={`knowledge-note-context-selector__item ${
                  selected
                    ? 'knowledge-note-context-selector__item--selected'
                    : ''
                }`}
                onClick={() => !disabledItem && toggleNote(note)}
                disabled={disabledItem}
              >
                <span className="knowledge-note-context-selector__item-main">
                  <span className="knowledge-note-context-selector__item-title">
                    {note.title || '未命名笔记'}
                  </span>
                  <span className="knowledge-note-context-selector__item-meta">
                    {[dirName, formatTime(note.updatedAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {selected ? <Check size={15} /> : null}
              </button>
            );
          })
        ) : (
          <div className="knowledge-note-context-selector__empty">
            {notes.length === 0 ? emptyText : noMatchText}
          </div>
        )}
      </div>

      <div className="knowledge-note-context-selector__footer">
        <span className="knowledge-note-context-selector__footer-text">
          {language === 'zh'
            ? `最多选择 ${maxNotes} 篇，提交时按需读取正文`
            : `Up to ${maxNotes}; content is read on submit`}
        </span>
        <span className="knowledge-note-context-selector__footer-actions">
          <button
            type="button"
            className="knowledge-note-context-selector__footer-add"
            onClick={openCreateKnowledgeNote}
            disabled={disabled}
            aria-label={compactState.addNoteAriaLabel}
          >
            <Plus size={12} />
            {compactState.addNoteLabel}
          </button>
          {compactState.canClear ? (
            <button
              type="button"
              className="knowledge-note-context-selector__footer-clear"
              onClick={clearSelectedNotes}
              disabled={disabled}
              aria-label={compactState.clearAriaLabel}
            >
              {compactState.clearLabel}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  ) : null;

  return (
    <div
      className={classNames(
        'knowledge-note-context-selector',
        {
          'knowledge-note-context-selector--compact': isCompact,
          'knowledge-note-context-selector--selected': selectedRefs.length > 0,
          'knowledge-note-context-selector--open': open,
          'knowledge-note-context-selector--placement-up':
            placement === 'up',
        },
        className
      )}
      ref={containerRef}
    >
      {!isCompact ? (
        <div className="knowledge-note-context-selector__header">
          <span className="knowledge-note-context-selector__label">
            {labelText}
          </span>
          {selectedRefs.length > 0 ? (
            <button
              type="button"
              className="knowledge-note-context-selector__clear"
              onClick={clearSelectedNotes}
              disabled={disabled}
            >
              {language === 'zh' ? '清空' : 'Clear'}
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className="knowledge-note-context-selector__trigger"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-expanded={open}
        aria-label={compactState.triggerLabel}
        title={
          isCompact
            ? compactState.selectedTitleText || compactState.triggerLabel
            : undefined
        }
      >
        <BookOpen size={isCompact ? 18 : 15} />
        {!isCompact ? (
          <>
            <span>
              {selectedRefs.length > 0
                ? language === 'zh'
                  ? `已选 ${selectedRefs.length} 篇笔记`
                  : `${selectedRefs.length} notes selected`
                : language === 'zh'
                  ? '选择知识库笔记'
                  : 'Select notes'}
            </span>
            <ChevronDown size={15} />
          </>
        ) : compactState.badgeText ? (
          <span className="knowledge-note-context-selector__badge">
            {compactState.badgeText}
          </span>
        ) : null}
      </button>

      {isCompact && selectedRefs.length > 0 ? (
        <div
          className="knowledge-note-context-selector__hover-summary"
          aria-label={
            language === 'zh'
              ? `已选知识库笔记：${compactState.selectedTitleText}`
              : `Selected knowledge notes: ${compactState.selectedTitleText}`
          }
        >
          <div className="knowledge-note-context-selector__hover-title">
            {compactState.hoverTitle}
          </div>
          <div className="knowledge-note-context-selector__hover-list">
            {selectedRefs.map((ref, index) => (
              <div
                key={ref.noteId}
                className="knowledge-note-context-selector__hover-item"
              >
                {compactState.noteTitles[index]}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!isCompact && selectedRefs.length > 0 ? (
        <div className="knowledge-note-context-selector__chips">
          {selectedRefs.map((ref) => (
            <span
              key={ref.noteId}
              className="knowledge-note-context-selector__chip"
            >
              <span>{ref.title}</span>
              <button
                type="button"
                onClick={() => removeNote(ref.noteId)}
                disabled={disabled}
                aria-label={language === 'zh' ? '移除笔记' : 'Remove note'}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {isCompact && dropdown
        ? createPortal(dropdown, (document.getElementById('creative-portals') || document.body))
        : dropdown}
    </div>
  );
};

export default KnowledgeNoteContextSelector;
