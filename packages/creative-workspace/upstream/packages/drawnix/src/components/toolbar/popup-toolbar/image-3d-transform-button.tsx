import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  PlaitBoard,
  PlaitElement,
  PlaitHistoryBoard,
  Transforms,
} from '@plait/core';
import { Box, Check, RotateCcw, X } from 'lucide-react';
import { ToolButton } from '../../tool-button';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import { Island } from '../../island';
import {
  DEFAULT_IMAGE_3D_PERSPECTIVE,
  Image3DTransform,
  sanitizeImage3DTransform,
} from '../../../utils/image-3d-transform';
import { notifyAISelectionContentRefresh } from '../../../utils/selection-utils';
import './image-3d-transform-button.scss';

type DraftImage3DTransform = Image3DTransform;
type Image3DTransformElement = PlaitElement & { transform3d?: unknown };
type SelectionScreenRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export interface PopupImage3DTransformButtonProps {
  board: PlaitBoard;
  element: PlaitElement;
  selectionRect?: SelectionScreenRect;
  title: string;
  language: 'zh' | 'en';
}

const IMAGE_3D_PANEL_MAX_WIDTH = 320;
const IMAGE_3D_PANEL_MIN_WIDTH = 252;
const IMAGE_3D_PANEL_EDGE_GAP = 12;
const IMAGE_3D_PANEL_ESTIMATED_HEIGHT = 220;

function getElementPath(board: PlaitBoard, elementId: string): number {
  return board.children.findIndex((child) => child.id === elementId);
}

function getElementTransform(
  element: PlaitElement
): Image3DTransform | undefined {
  return sanitizeImage3DTransform(
    (element as Image3DTransformElement).transform3d
  );
}

function toDraftTransform(transform?: Image3DTransform): DraftImage3DTransform {
  return {
    rotateX: transform?.rotateX ?? 0,
    rotateY: transform?.rotateY ?? 0,
    perspective: transform?.perspective ?? DEFAULT_IMAGE_3D_PERSPECTIVE,
  };
}

function areTransformsEqual(
  left: Image3DTransform | undefined,
  right: Image3DTransform | undefined
): boolean {
  const normalizedLeft = sanitizeImage3DTransform(left);
  const normalizedRight = sanitizeImage3DTransform(right);
  if (!normalizedLeft && !normalizedRight) {
    return true;
  }
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return (
    normalizedLeft.rotateX === normalizedRight.rotateX &&
    normalizedLeft.rotateY === normalizedRight.rotateY &&
    normalizedLeft.perspective === normalizedRight.perspective
  );
}

function setImage3DTransform(
  board: PlaitBoard,
  elementId: string,
  transform: Image3DTransform | undefined
): void {
  const path = getElementPath(board, elementId);
  if (path < 0) {
    return;
  }
  Transforms.setNode(
    board,
    { transform3d: transform } as Partial<PlaitElement>,
    [path]
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getRangeProgress(value: number, min: number, max: number): string {
  const range = max - min;
  if (range <= 0) {
    return '0%';
  }
  const progress = ((clampNumber(value, min, max) - min) / range) * 100;
  return `${progress.toFixed(2)}%`;
}

function getSidePanelLayout(selectionRect?: SelectionScreenRect): {
  contentStyle?: React.CSSProperties;
  panelStyle?: React.CSSProperties;
} {
  if (typeof window === 'undefined' || !selectionRect) {
    return {};
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const leftSpace = selectionRect.left;
  const rightSpace = viewportWidth - selectionRect.right;
  const placeRight = rightSpace >= leftSpace;
  const sideSpace = placeRight ? rightSpace : leftSpace;
  const panelWidth = clampNumber(
    sideSpace - IMAGE_3D_PANEL_EDGE_GAP * 2,
    IMAGE_3D_PANEL_MIN_WIDTH,
    IMAGE_3D_PANEL_MAX_WIDTH
  );
  const left = placeRight
    ? Math.min(
        selectionRect.right + IMAGE_3D_PANEL_EDGE_GAP,
        viewportWidth - panelWidth - IMAGE_3D_PANEL_EDGE_GAP
      )
    : Math.max(
        IMAGE_3D_PANEL_EDGE_GAP,
        selectionRect.left - panelWidth - IMAGE_3D_PANEL_EDGE_GAP
      );
  const top = clampNumber(
    selectionRect.top,
    IMAGE_3D_PANEL_EDGE_GAP,
    Math.max(
      IMAGE_3D_PANEL_EDGE_GAP,
      viewportHeight - IMAGE_3D_PANEL_ESTIMATED_HEIGHT - IMAGE_3D_PANEL_EDGE_GAP
    )
  );

  return {
    contentStyle: {
      left,
      top,
      position: 'fixed',
      transform: 'none',
    },
    panelStyle: {
      width: panelWidth,
    },
  };
}

export const PopupImage3DTransformButton: React.FC<
  PopupImage3DTransformButtonProps
> = ({ board, element, selectionRect, title, language }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftImage3DTransform>(() =>
    toDraftTransform(getElementTransform(element))
  );
  const startTransformRef = useRef<Image3DTransform | undefined>(undefined);
  const confirmedRef = useRef(false);
  const elementId = element.id;
  const container = PlaitBoard.getBoardContainer(board);
  const panelLayout = getSidePanelLayout(selectionRect);

  const previewTransform = useCallback(
    (nextDraft: DraftImage3DTransform) => {
      setDraft(nextDraft);
      PlaitHistoryBoard.withoutSaving(board, () => {
        setImage3DTransform(
          board,
          elementId,
          sanitizeImage3DTransform(nextDraft)
        );
      });
    },
    [board, elementId]
  );

  const restoreStartTransform = useCallback(() => {
    PlaitHistoryBoard.withoutSaving(board, () => {
      setImage3DTransform(board, elementId, startTransformRef.current);
    });
  }, [board, elementId]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        const currentTransform = getElementTransform(element);
        startTransformRef.current = currentTransform;
        confirmedRef.current = false;
        setDraft(toDraftTransform(currentTransform));
        setOpen(true);
        return;
      }

      if (open && !confirmedRef.current) {
        restoreStartTransform();
      }
      setOpen(false);
    },
    [element, open, restoreStartTransform]
  );

  const updateDraftValue = useCallback(
    (key: keyof DraftImage3DTransform, value: number) => {
      const limits =
        key === 'perspective'
          ? { min: 200, max: 3000 }
          : { min: -180, max: 180 };
      previewTransform({
        ...draft,
        [key]: clampNumber(value, limits.min, limits.max),
      });
    },
    [draft, previewTransform]
  );

  const resetDraft = useCallback(() => {
    previewTransform({
      rotateX: 0,
      rotateY: 0,
      perspective: DEFAULT_IMAGE_3D_PERSPECTIVE,
    });
  }, [previewTransform]);

  const confirmDraft = useCallback(() => {
    const finalTransform = sanitizeImage3DTransform(draft);
    confirmedRef.current = true;
    PlaitHistoryBoard.withoutSaving(board, () => {
      setImage3DTransform(board, elementId, startTransformRef.current);
    });
    if (!areTransformsEqual(startTransformRef.current, finalTransform)) {
      PlaitHistoryBoard.withNewBatch(board, () => {
        setImage3DTransform(board, elementId, finalTransform);
      });
    }
    notifyAISelectionContentRefresh();
    setOpen(false);
  }, [board, draft, elementId]);

  const cancelDraft = useCallback(() => {
    confirmedRef.current = true;
    restoreStartTransform();
    setOpen(false);
  }, [restoreStartTransform]);

  useEffect(() => {
    if (open) {
      handleOpenChange(false);
    }
    // 选中元素切换时关闭面板并回滚未确认预览。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementId]);

  const labels = {
    rotateX: language === 'zh' ? '上下倾斜' : 'Rotate X',
    rotateY: language === 'zh' ? '左右倾斜' : 'Rotate Y',
    perspective: language === 'zh' ? '透视距离' : 'Perspective',
    reset: language === 'zh' ? '重置' : 'Reset',
    cancel: language === 'zh' ? '取消' : 'Cancel',
    confirm: language === 'zh' ? '确定' : 'Apply',
  };

  const renderControl = (
    key: keyof DraftImage3DTransform,
    label: string,
    min: number,
    max: number,
    step: number,
    suffix: string
  ) => (
    <label className="image-3d-control-row">
      <span className="image-3d-control-label">{label}</span>
      <input
        className="image-3d-control-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft[key]}
        style={
          {
            '--image-3d-slider-progress': getRangeProgress(
              draft[key],
              min,
              max
            ),
          } as React.CSSProperties
        }
        onChange={(event) => updateDraftValue(key, Number(event.target.value))}
      />
      <span className="image-3d-control-number">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft[key]}
          onChange={(event) =>
            updateDraftValue(key, Number(event.target.value))
          }
        />
        <em>{suffix}</em>
      </span>
    </label>
  );

  return (
    <Popover
      sideOffset={12}
      open={open}
      onOpenChange={handleOpenChange}
      placement="right-start"
    >
      <PopoverTrigger asChild>
        <ToolButton
          className={classNames('property-button', 'image-3d-transform-button')}
          selected={open || !!getElementTransform(element)}
          visible={true}
          icon={<Box size={15} />}
          type="button"
          tooltip={title}
          aria-label={title}
          data-track="toolbar_click_image_3d_transform"
          onPointerUp={() => handleOpenChange(!open)}
        />
      </PopoverTrigger>
      <PopoverContent container={container} style={panelLayout.contentStyle}>
        <Island
          padding={1}
          style={panelLayout.panelStyle}
          className={classNames(
            ATTACHED_ELEMENT_CLASS_NAME,
            'image-3d-transform-panel'
          )}
        >
          <div className="image-3d-control-list">
            {renderControl('rotateY', labels.rotateY, -180, 180, 1, 'deg')}
            {renderControl('rotateX', labels.rotateX, -180, 180, 1, 'deg')}
            {renderControl(
              'perspective',
              labels.perspective,
              200,
              3000,
              20,
              'px'
            )}
          </div>
          <div className="image-3d-control-actions">
            <button type="button" onClick={resetDraft}>
              <RotateCcw size={14} />
              <span>{labels.reset}</span>
            </button>
            <button type="button" onClick={cancelDraft}>
              <X size={14} />
              <span>{labels.cancel}</span>
            </button>
            <button
              type="button"
              className="image-3d-control-confirm"
              onClick={confirmDraft}
            >
              <Check size={14} />
              <span>{labels.confirm}</span>
            </button>
          </div>
        </Island>
      </PopoverContent>
    </Popover>
  );
};

export default PopupImage3DTransformButton;
