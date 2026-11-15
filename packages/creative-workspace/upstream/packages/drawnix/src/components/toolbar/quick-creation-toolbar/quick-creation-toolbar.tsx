import React, {
  Suspense,
  lazy,
  useEffect,
  useState,
  useRef,
  useCallback,
} from 'react';
import { useBoard } from '@plait-board/react-board';
import { flip, offset, shift, useFloating } from '@floating-ui/react';
import { Island } from '../../island';
import Stack from '../../stack';
import { ToolButton } from '../../tool-button';
import {
  TextIcon,
  MediaLibraryIcon,
  ImageUploadIcon,
  FeltTipPenIcon,
  StraightArrowLineIcon,
  ShapeIcon,
  MindIcon,
} from '../../icons';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  BoardTransforms,
  PlaitBoard,
  toHostPointFromViewBoxPoint,
  toScreenPointFromHostPoint,
} from '@plait/core';
import { BasicShapes, ArrowLineShape, DrawPointerType } from '@plait/draw';
import { MindPointerType } from '@plait/mind';
import { FreehandShape } from '../../../plugins/freehand/type';
import { PenShape } from '../../../plugins/pen/type';
import { finishPenOnToolSwitch } from '../../../plugins/pen/with-pen-create';
import { DrawnixPointerType, useSetPointer } from '../../../hooks/use-drawnix';
import { addImage } from '../../../utils/image';
import { useI18n } from '../../../i18n';
import { getAssetRuntimeUrl } from '../../../utils/desktop-asset-url';
import { BoardCreationMode, setCreationMode } from '@plait/common';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import { ShapePicker } from '../../shape-picker';
import { ArrowPicker } from '../../arrow-picker';
import { FreehandPanel } from '../freehand-panel/freehand-panel';
import { Z_INDEX } from '../../../constants/z-index';
import { SelectionMode, Asset, AssetType } from '../../../types/asset.types';
import { insertImageFromUrl } from '../../../data/image';
import { insertVideoFromUrl } from '../../../data/video';
import { insertAudioFromUrl } from '../../../data/audio';
import { executeCanvasInsertion } from '../../../services/canvas-operations';
import { logCanvasInsertionDebug, calculateImageDisplayDimensions, CANVAS_INSERTION_LAYOUT } from '../../../utils/canvas-insertion-layout';
import { MessagePlugin } from 'tdesign-react';
import './quick-creation-toolbar.scss';

const MediaLibraryModal = lazy(() =>
  import('../../media-library/MediaLibraryModal').then((module) => ({
    default: module.MediaLibraryModal,
  }))
);

export interface QuickCreationToolbarProps {
  position: [number, number] | null; // 屏幕坐标
  visible: boolean;
  onClose: () => void;
  onOpenMediaLibrary?: (config?: {
    mode?: SelectionMode;
    filterType?: AssetType;
    onSelect?: (asset: Asset) => void | Promise<void>;
    onSelectMultiple?: (assets: Asset[]) => void | Promise<void>;
    selectButtonText?: string;
    batchSelectButtonText?: string;
  }) => void;
}

enum PopupKey {
  'shape' = 'shape',
  'arrow' = 'arrow',
  'freehand' = 'freehand',
}

export const QuickCreationToolbar: React.FC<QuickCreationToolbarProps> = ({
  position,
  visible,
  onClose,
  onOpenMediaLibrary,
}) => {
  const board = useBoard();
  const { t } = useI18n();
  const setPointer = useSetPointer();
  const container = PlaitBoard.getBoardContainer(board);

  // Popover 状态
  const [openPopovers, setOpenPopovers] = useState<Record<PopupKey, boolean>>({
    [PopupKey.freehand]: false,
    [PopupKey.arrow]: false,
    [PopupKey.shape]: false,
  });

  // 素材库状态
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);

  const { refs, floatingStyles } = useFloating({
    placement: 'bottom',
    middleware: [
      offset(12),
      shift({ padding: 16 }),
      flip({ fallbackPlacements: ['top', 'right', 'left'] }),
    ],
  });

  // 设置参考位置
  useEffect(() => {
    if (position && visible) {
      const [x, y] = position;
      refs.setPositionReference({
        getBoundingClientRect() {
          return {
            width: 1,
            height: 1,
            x,
            y,
            top: y,
            left: x,
            right: x + 1,
            bottom: y + 1,
          };
        },
      });
    }
  }, [position, visible, refs]);

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // 检查是否点击了工具栏、Popover 内容或素材库
      const isInsideToolbar = target.closest('.quick-creation-toolbar');
      const isInsidePopover =
        target.closest('.quick-toolbar-popover') ||
        target.closest('[data-radix-popper-content-wrapper]') ||
        target.closest('.plait-popover') ||
        target.closest('.shape-picker') ||
        target.closest('.arrow-picker') ||
        target.closest('.freehand-panel');
      const isInsideMediaLibrary = target.closest('.media-library-modal');

      if (!isInsideToolbar && !isInsidePopover && !isInsideMediaLibrary) {
        onClose();
      }
    };

    // 延迟添加监听器，避免立即关闭
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [visible, onClose]);

  const resetAllPopovers = () => {
    setOpenPopovers({
      [PopupKey.freehand]: false,
      [PopupKey.arrow]: false,
      [PopupKey.shape]: false,
    });
  };

  const showPopover = (key: PopupKey) => {
    setOpenPopovers({
      [PopupKey.freehand]: false,
      [PopupKey.arrow]: false,
      [PopupKey.shape]: false,
      [key]: true,
    });
  };

  // 工具按钮处理函数
  const handleTextClick = () => {
    resetAllPopovers();
    finishPenOnToolSwitch(board);
    setCreationMode(board, null as any);
    BoardTransforms.updatePointerType(board, BasicShapes.text);
    setPointer(BasicShapes.text);
    onClose();
  };

  const handleMindClick = () => {
    resetAllPopovers();
    // 切换工具前，结束钢笔绘制
    finishPenOnToolSwitch(board);
    // 思维导图使用 dnd 模式
    setCreationMode(board, BoardCreationMode.dnd);
    BoardTransforms.updatePointerType(board, MindPointerType.mind);
    setPointer(MindPointerType.mind);
    onClose();
  };

  const handleImageClick = () => {
    resetAllPopovers();
    addImage(board);
    onClose();
  };

  const handleInsertAsset = async (asset: Asset) => {
    try {
      const runtimeUrl = getAssetRuntimeUrl(asset);
      if (asset.type === AssetType.IMAGE) {
        await insertImageFromUrl(board, runtimeUrl);
      } else if (asset.type === AssetType.VIDEO) {
        await insertVideoFromUrl(board, runtimeUrl);
      } else if (asset.type === AssetType.AUDIO) {
        await insertAudioFromUrl(board, runtimeUrl, {
          title: asset.name,
          duration: asset.duration,
          previewImageUrl: asset.thumbnail,
          prompt: asset.prompt,
          mv: asset.modelName,
          clipId: asset.clipId,
          providerTaskId: asset.providerTaskId,
        });
      }
      MessagePlugin.success(
        t('toolbar.assetInserted' as any) || '素材已插入到画板'
      );
      setMediaLibraryOpen(false);
      onClose();
    } catch (error) {
      console.error('Failed to insert asset:', error);
      MessagePlugin.error(
        t('toolbar.assetInsertFailed' as any) || '插入素材失败'
      );
    }
  };

  /**
   * 预加载图片并计算合理的显示尺寸（素材库图片为本地缓存，加载几乎即时）
   * 使用与 buildImage 一致的缩放逻辑，确保网格布局正确
   */
  const loadImageDimensions = (
    url: string
  ): Promise<{ width: number; height: number }> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const dimensions = calculateImageDisplayDimensions(
          img.naturalWidth, 
          img.naturalHeight,
          CANVAS_INSERTION_LAYOUT.MEDIA_MAX_SIZE
        );
        resolve(dimensions);
      };
      img.onerror = () => resolve({ width: 400, height: 400 });
      img.src = url;
    });

  const handleInsertMultipleAssets = async (assets: Asset[]) => {
    if (assets.length === 0) return;

    // 预加载所有图片的真实尺寸，供排位系统使用
    const imageDimensionsMap = new Map<string, { width: number; height: number }>();
    const imageAssets = assets.filter((a) => a.type === AssetType.IMAGE);
    if (imageAssets.length > 0) {
      const results = await Promise.all(
        imageAssets.map((a) => loadImageDimensions(getAssetRuntimeUrl(a)))
      );
      imageAssets.forEach((a, i) =>
        imageDimensionsMap.set(getAssetRuntimeUrl(a), results[i])
      );
    }

    logCanvasInsertionDebug('[CanvasInsertion][Toolbar] batch assets begin', {
      source: 'quick-creation-toolbar',
      strategy: 'shared-batch-layout',
      assetsCount: assets.length,
      assetTypes: assets.map((asset) => asset.type),
      zoom: (board as any)?.viewport?.zoom || 1,
    });

    const insertionResult = await executeCanvasInsertion({
      items: assets.map((asset) => {
        const runtimeUrl = getAssetRuntimeUrl(asset);
        if (asset.type === AssetType.IMAGE) {
          return {
            type: 'image' as const,
            content: runtimeUrl,
            dimensions: imageDimensionsMap.get(runtimeUrl),
          };
        }

        if (asset.type === AssetType.VIDEO) {
          return { type: 'video' as const, content: runtimeUrl };
        }

        return {
          type: 'audio' as const,
          content: runtimeUrl,
          metadata: {
            title: asset.name,
            duration: asset.duration,
            previewImageUrl: asset.thumbnail,
            prompt: asset.prompt,
            mv: asset.modelName,
            clipId: asset.clipId,
            providerTaskId: asset.providerTaskId,
          },
        };
      }),
      // 素材库批量插入时使用更大的间隔，让图片之间更清晰
      horizontalGap: 30,
      verticalGap: 40,
    });

    if (insertionResult.success) {
      const insertedCount =
        (insertionResult.data as { insertedCount?: number } | undefined)
          ?.insertedCount ?? assets.length;
      MessagePlugin.success(`已成功插入 ${insertedCount} 个素材到画板`);
    } else {
      MessagePlugin.error(insertionResult.error || '插入素材失败');
    }

    setMediaLibraryOpen(false);
    onClose();
  };

  const handleMediaLibraryClick = () => {
    resetAllPopovers();
    if (onOpenMediaLibrary) {
      onOpenMediaLibrary({
        mode: SelectionMode.SELECT,
        onSelect: handleInsertAsset,
        onSelectMultiple: handleInsertMultipleAssets,
        selectButtonText: t('toolbar.insert' as any) || '插入',
        batchSelectButtonText: '批量插入画布',
      });
      onClose();
      return;
    }
    setMediaLibraryOpen(true);
  };

  // 保存最后选择的画笔类型
  const [lastFreehandPointer, setLastFreehandPointer] =
    useState<DrawnixPointerType>(FreehandShape.feltTipPen);

  // Hover 展开延迟计时器
  const HOVER_DELAY = 300; // 毫秒
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清除 hover 计时器
  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  // 组件卸载时清除计时器
  useEffect(() => {
    return () => {
      clearHoverTimeout();
    };
  }, [clearHoverTimeout]);

  // 渲染带 Popover 的按钮
  const renderPopoverButton = (
    icon: React.ReactNode,
    popupKey: PopupKey,
    title: string,
    content: React.ReactNode
  ) => {
    return (
      <Popover
        open={openPopovers[popupKey]}
        sideOffset={12}
        onOpenChange={(open) => {
          if (!open) {
            resetAllPopovers();
          }
        }}
        placement="bottom"
      >
        <PopoverTrigger asChild>
          <div
            onPointerEnter={() => {
              // 清除之前的计时器
              clearHoverTimeout();
              // 设置延迟展开
              hoverTimeoutRef.current = setTimeout(() => {
                showPopover(popupKey);
              }, HOVER_DELAY);
            }}
            onPointerLeave={() => {
              // 离开时清除计时器（如果还没触发）
              clearHoverTimeout();
            }}
          >
            <ToolButton
              type="icon"
              visible={true}
              selected={openPopovers[popupKey]}
              icon={icon}
              aria-label={title}
              data-track={`quick_toolbar_click_${popupKey}`}
              onPointerDown={() => {
                // 点击时立即展开，清除 hover 计时器
                clearHoverTimeout();
                showPopover(popupKey);
                // 切换工具前，结束钢笔绘制
                finishPenOnToolSwitch(board);
                // 画笔工具需要特殊处理：按下时设置 dnd 模式
                if (popupKey === PopupKey.freehand) {
                  setCreationMode(board, BoardCreationMode.dnd);
                  BoardTransforms.updatePointerType(board, lastFreehandPointer);
                  setPointer(lastFreehandPointer);
                }
              }}
              onPointerUp={() => {
                // 画笔工具需要特殊处理：松开时设置 drawing 模式
                if (popupKey === PopupKey.freehand) {
                  setCreationMode(board, BoardCreationMode.drawing);
                }
              }}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent
          container={container}
          style={{ zIndex: Z_INDEX.POPOVER }}
          className="quick-toolbar-popover"
        >
          {content}
        </PopoverContent>
      </Popover>
    );
  };

  if (!visible) return null;

  return (
    <>
      <Island
        padding={1}
        className={`quick-creation-toolbar ${ATTACHED_ELEMENT_CLASS_NAME}`}
        ref={refs.setFloating}
        style={floatingStyles}
      >
        <Stack.Row gap={1}>
          {/* T - 文本工具 */}
          <ToolButton
            type="icon"
            visible={true}
            icon={<TextIcon />}
            aria-label={t('toolbar.text')}
            data-track="quick_toolbar_click_text"
            onPointerUp={handleTextClick}
          />

          {/* 图片 */}
          <ToolButton
            type="icon"
            visible={true}
            icon={<ImageUploadIcon size={24} />}
            aria-label={t('toolbar.image')}
            data-track="quick_toolbar_click_image"
            onPointerUp={handleImageClick}
          />

          {/* 素材库 */}
          <ToolButton
            type="icon"
            visible={true}
            icon={<MediaLibraryIcon />}
            aria-label={t('toolbar.mediaLibrary')}
            data-track="quick_toolbar_click_media_library"
            onPointerUp={handleMediaLibraryClick}
          />

          {/* 画笔 - 带 Popover */}
          {renderPopoverButton(
            <FeltTipPenIcon />,
            PopupKey.freehand,
            t('toolbar.pen'),
            <FreehandPanel
              onPointerUp={(pointer: DrawnixPointerType) => {
                resetAllPopovers();
                // 保存最后选择的画笔类型
                setLastFreehandPointer(pointer);
                // 更新 pointer
                BoardTransforms.updatePointerType(board, pointer);
                setPointer(pointer);
                onClose();
              }}
            />
          )}

          {/* 箭头 - 带 Popover */}
          {renderPopoverButton(
            <StraightArrowLineIcon />,
            PopupKey.arrow,
            t('toolbar.arrow'),
            <ArrowPicker
              onPointerUp={(pointer: DrawPointerType) => {
                resetAllPopovers();
                BoardTransforms.updatePointerType(board, pointer);
                setPointer(pointer);
                onClose();
              }}
            />
          )}

          {/* 形状 - 带 Popover */}
          {renderPopoverButton(
            <ShapeIcon />,
            PopupKey.shape,
            t('toolbar.shape'),
            <ShapePicker
              onPointerUp={(pointer: DrawPointerType) => {
                resetAllPopovers();
                BoardTransforms.updatePointerType(board, pointer);
                setPointer(pointer);
                onClose();
              }}
            />
          )}

          {/* 思维导图 */}
          <ToolButton
            type="icon"
            visible={true}
            icon={<MindIcon />}
            aria-label={t('toolbar.mind')}
            data-track="quick_toolbar_click_mind"
            onPointerUp={handleMindClick}
          />
        </Stack.Row>
      </Island>

      {/* 素材库弹窗 */}
      {mediaLibraryOpen && (
        <Suspense fallback={null}>
          <MediaLibraryModal
            isOpen={mediaLibraryOpen}
            onClose={() => {
              setMediaLibraryOpen(false);
            }}
            mode={SelectionMode.SELECT}
            onSelect={handleInsertAsset}
            onSelectMultiple={handleInsertMultipleAssets}
            selectButtonText={t('toolbar.insert' as any) || '插入'}
            batchSelectButtonText="批量插入画布"
          />
        </Suspense>
      )}
    </>
  );
};
