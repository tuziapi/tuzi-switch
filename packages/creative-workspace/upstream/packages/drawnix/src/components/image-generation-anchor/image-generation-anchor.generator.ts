import { RectangleClient, type PlaitBoard } from '@plait/core';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import {
  IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
  type ImageGenerationAnchorPhase,
  type PlaitImageGenerationAnchor,
} from '../../types/image-generation-anchor.types';
import { isTauriEnvironment } from '../../utils/tauri-env';
import { ImageGenerationAnchorContent } from './ImageGenerationAnchorContent';

const SVG_NS = 'http://www.w3.org/2000/svg';

const DESKTOP_PHASE_LABELS: Record<ImageGenerationAnchorPhase, string> = {
  submitted: '准备生成',
  queued: '等待执行',
  generating: '生成中',
  developing: '正在显影',
  inserting: '正在放入画布',
  completed: '已完成',
  failed: '生成失败',
};

const DESKTOP_PHASE_SUBTITLES: Record<ImageGenerationAnchorPhase, string> = {
  submitted: '正在创建图片生成任务',
  queued: '请求已受理，请稍候',
  generating: '图片正在生成，请稍候',
  developing: '结果已返回，正在处理图片',
  inserting: '正在把图片放入画布',
  completed: '图片已放入画布',
  failed: '图片生成失败',
};

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tagName: K
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

export class ImageGenerationAnchorGenerator {
  constructor(private board: PlaitBoard) {}

  private foreignObject: SVGForeignObjectElement | null = null;
  private htmlContainer: HTMLElement | null = null;
  private reactRoot: Root | null = null;
  private desktopFallback: SVGGElement | null = null;
  private renderTimer: number | null = null;

  processDrawing(
    element: PlaitImageGenerationAnchor,
    parentG: SVGGElement,
    selected: boolean
  ): SVGGElement {
    const g = createSvgElement('g');
    g.setAttribute('class', 'image-generation-anchor-element');
    parentG.appendChild(g);

    if (isTauriEnvironment()) {
      this.createDesktopFallback(element, g);
    } else {
      this.createForeignObject(element, g);
      // WebKit is sensitive to mounting a React root before foreignObject is
      // connected to the live SVG tree.
      this.renderTimer = window.setTimeout(() => {
        this.renderTimer = null;
        this.renderReact(element, selected);
      }, 0);
    }
    return g;
  }

  updateDrawing(
    element: PlaitImageGenerationAnchor,
    _g: SVGGElement,
    selected: boolean
  ): void {
    if (this.desktopFallback) {
      this.renderDesktopFallback(element);
      return;
    }

    this.updateForeignObject(element);
    this.renderReact(element, selected);
  }

  private createDesktopFallback(
    element: PlaitImageGenerationAnchor,
    g: SVGGElement
  ): void {
    this.desktopFallback = createSvgElement('g');
    this.desktopFallback.setAttribute(
      'class',
      'image-generation-anchor-desktop-fallback'
    );
    this.desktopFallback.style.pointerEvents = 'auto';
    g.appendChild(this.desktopFallback);
    this.renderDesktopFallback(element);
  }

  private renderDesktopFallback(element: PlaitImageGenerationAnchor): void {
    const host = this.desktopFallback;
    if (!host) {
      return;
    }

    host.replaceChildren();
    const rect = RectangleClient.getRectangleByPoints(element.points);
    const isFailed = element.phase === 'failed';
    const isCompleted = element.phase === 'completed';
    const accent = isFailed ? '#c15a5a' : '#25755e';
    const background = isFailed
      ? '#fffafa'
      : isCompleted
      ? '#f8fcfa'
      : '#fcfdfc';
    const border = isFailed ? '#e5caca' : isCompleted ? '#c9dfd4' : '#dfe4e9';
    const minDimension = Math.min(rect.width, rect.height);
    const compact = rect.width < 220 || rect.height < 190;
    const titleSize = compact ? 14 : 18;
    const bodySize = compact ? 11 : 13;
    const padding = compact ? 12 : 20;
    const progress =
      typeof element.progress === 'number'
        ? Math.max(0, Math.min(100, Math.round(element.progress)))
        : null;
    const phaseLabel = DESKTOP_PHASE_LABELS[element.phase];
    const subtitle = isFailed
      ? element.error || DESKTOP_PHASE_SUBTITLES.failed
      : element.subtitle || DESKTOP_PHASE_SUBTITLES[element.phase];

    host.setAttribute(
      'aria-label',
      `${DESKTOP_PHASE_LABELS[element.phase]}：${subtitle}`
    );

    const backgroundRect = createSvgElement('rect');
    backgroundRect.setAttribute('x', String(rect.x));
    backgroundRect.setAttribute('y', String(rect.y));
    backgroundRect.setAttribute('width', String(rect.width));
    backgroundRect.setAttribute('height', String(rect.height));
    backgroundRect.setAttribute('rx', String(Math.min(18, minDimension / 8)));
    backgroundRect.setAttribute('fill', background);
    backgroundRect.setAttribute('stroke', border);
    backgroundRect.setAttribute('stroke-width', '1');
    host.appendChild(backgroundRect);

    if (!compact) {
      const patternId = `generation-anchor-grid-${encodeURIComponent(
        element.id
      )}`;
      const defs = createSvgElement('defs');
      const pattern = createSvgElement('pattern');
      pattern.setAttribute('id', patternId);
      pattern.setAttribute('width', '18');
      pattern.setAttribute('height', '18');
      pattern.setAttribute('patternUnits', 'userSpaceOnUse');
      const dot = createSvgElement('circle');
      dot.setAttribute('cx', '1');
      dot.setAttribute('cy', '1');
      dot.setAttribute('r', '0.65');
      dot.setAttribute('fill', '#d5ddd8');
      pattern.appendChild(dot);
      defs.appendChild(pattern);
      host.appendChild(defs);

      const grid = createSvgElement('rect');
      grid.setAttribute('class', 'image-generation-anchor-desktop-grid');
      grid.setAttribute('x', String(rect.x + padding));
      grid.setAttribute('y', String(rect.y + 52));
      grid.setAttribute('width', String(rect.width - padding * 2));
      grid.setAttribute('height', String(rect.height - 112));
      grid.setAttribute('fill', `url(#${patternId})`);
      grid.setAttribute('opacity', '0.65');
      grid.style.pointerEvents = 'none';
      host.appendChild(grid);

      const left = rect.x + 32;
      const right = rect.x + rect.width - 32;
      const top = rect.y + 64;
      const bottom = rect.y + rect.height - 64;
      const corners = createSvgElement('path');
      corners.setAttribute('class', 'image-generation-anchor-desktop-corners');
      corners.setAttribute(
        'd',
        `M ${left + 14} ${top} H ${left} V ${top + 14} ` +
          `M ${right - 14} ${top} H ${right} V ${top + 14} ` +
          `M ${left} ${bottom - 14} V ${bottom} H ${left + 14} ` +
          `M ${right} ${bottom - 14} V ${bottom} H ${right - 14}`
      );
      corners.setAttribute('fill', 'none');
      corners.setAttribute('stroke', '#b7c8bd');
      corners.setAttribute('stroke-width', '1.2');
      corners.style.pointerEvents = 'none';
      host.appendChild(corners);

      const count =
        element.batchTotal ||
        element.requestedCount ||
        element.taskIds.length ||
        1;
      const header = createSvgElement('text');
      header.setAttribute('x', String(rect.x + 22));
      header.setAttribute('y', String(rect.y + 32));
      header.setAttribute('fill', '#777e88');
      header.setAttribute('font-size', '11');
      header.textContent = count > 1 ? '批量生成' : '图片生成';
      host.appendChild(header);
      const counter = createSvgElement('text');
      counter.setAttribute('x', String(rect.x + rect.width - 22));
      counter.setAttribute('y', String(rect.y + 32));
      counter.setAttribute('text-anchor', 'end');
      counter.setAttribute('fill', '#777e88');
      counter.setAttribute('font-size', '11');
      counter.textContent = `${count} 张`;
      host.appendChild(counter);
    }

    if (element.previewImageUrl) {
      const preview = createSvgElement('image');
      preview.setAttribute('x', String(rect.x));
      preview.setAttribute('y', String(rect.y));
      preview.setAttribute('width', String(rect.width));
      preview.setAttribute('height', String(rect.height));
      preview.setAttribute('href', element.previewImageUrl);
      preview.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      host.appendChild(preview);
    }

    const centerX = rect.x + rect.width / 2;
    const spinning = !isFailed && !isCompleted;
    const spinnerRadius = compact ? 10 : Math.min(28, minDimension * 0.1);
    const contentCenterY =
      rect.y +
      (compact
        ? rect.height * (isFailed ? 0.34 : 0.5)
        : (rect.height - (spinning ? 2 * spinnerRadius + 68 : 42)) / 2 +
          (spinning ? spinnerRadius : 9));
    const spinnerX = compact
      ? centerX - (phaseLabel.length * titleSize) / 2 - 10
      : centerX;

    if (spinning) {
      const spinnerTrack = createSvgElement('circle');
      spinnerTrack.setAttribute('cx', String(spinnerX));
      spinnerTrack.setAttribute('cy', String(contentCenterY));
      spinnerTrack.setAttribute('r', String(spinnerRadius));
      spinnerTrack.setAttribute('fill', 'none');
      spinnerTrack.setAttribute('stroke', '#e7ebef');
      spinnerTrack.setAttribute('stroke-width', '3');
      host.appendChild(spinnerTrack);

      const spinner = createSvgElement('circle');
      spinner.setAttribute('cx', String(spinnerX));
      spinner.setAttribute('cy', String(contentCenterY));
      spinner.setAttribute('r', String(spinnerRadius));
      spinner.setAttribute('fill', 'none');
      spinner.setAttribute('stroke', accent);
      spinner.setAttribute('stroke-width', '3');
      spinner.setAttribute('stroke-linecap', 'round');
      spinner.setAttribute(
        'stroke-dasharray',
        `${spinnerRadius * 1.7} ${spinnerRadius * (2 * Math.PI - 1.7)}`
      );
      const spinnerAnimation = createSvgElement('animateTransform');
      spinnerAnimation.setAttribute('attributeName', 'transform');
      spinnerAnimation.setAttribute('type', 'rotate');
      spinnerAnimation.setAttribute('from', `0 ${spinnerX} ${contentCenterY}`);
      spinnerAnimation.setAttribute('to', `360 ${spinnerX} ${contentCenterY}`);
      spinnerAnimation.setAttribute('dur', '1.05s');
      spinnerAnimation.setAttribute('repeatCount', 'indefinite');
      spinner.appendChild(spinnerAnimation);
      host.appendChild(spinner);
    }

    const title = createSvgElement('text');
    title.setAttribute('x', String(centerX + (compact && spinning ? 12 : 0)));
    title.setAttribute(
      'y',
      String(
        spinning && !compact
          ? contentCenterY + spinnerRadius + 30
          : contentCenterY
      )
    );
    title.setAttribute('text-anchor', 'middle');
    title.setAttribute('dominant-baseline', 'middle');
    title.setAttribute('fill', isFailed ? '#9c4b4b' : '#27313a');
    title.setAttribute(
      'font-family',
      '-apple-system, BlinkMacSystemFont, sans-serif'
    );
    title.setAttribute('font-size', String(titleSize));
    title.setAttribute('font-weight', '650');
    title.textContent = phaseLabel;
    host.appendChild(title);

    if (!compact) {
      const maxChars = Math.max(
        12,
        Math.floor((rect.width - padding * 2) / 13)
      );
      const description = createSvgElement('text');
      description.setAttribute('x', String(centerX));
      description.setAttribute(
        'y',
        String(
          spinning ? contentCenterY + spinnerRadius + 56 : contentCenterY + 30
        )
      );
      description.setAttribute('text-anchor', 'middle');
      description.setAttribute('fill', isFailed ? '#a76565' : '#74808b');
      description.setAttribute(
        'font-family',
        '-apple-system, BlinkMacSystemFont, sans-serif'
      );
      description.setAttribute('font-size', String(bodySize));
      description.textContent = truncateText(subtitle, maxChars);
      host.appendChild(description);
    }

    if (spinning && !compact && rect.height >= 230 && progress != null) {
      const progressWidth = Math.min(180, rect.width - padding * 2);
      const progressX = centerX - progressWidth / 2;
      const progressY = rect.y + rect.height - Math.max(22, padding);
      const progressTrack = createSvgElement('rect');
      progressTrack.setAttribute('x', String(progressX));
      progressTrack.setAttribute('y', String(progressY));
      progressTrack.setAttribute('width', String(progressWidth));
      progressTrack.setAttribute('height', '3');
      progressTrack.setAttribute('rx', '1.5');
      progressTrack.setAttribute('fill', '#e7ebef');
      host.appendChild(progressTrack);
      const progressBar = createSvgElement('rect');
      progressBar.setAttribute('x', String(progressX));
      progressBar.setAttribute('y', String(progressY));
      progressBar.setAttribute(
        'width',
        String((progressWidth * progress) / 100)
      );
      progressBar.setAttribute('height', '3');
      progressBar.setAttribute('rx', '1.5');
      progressBar.setAttribute('fill', accent);
      host.appendChild(progressBar);
    }

    if (isFailed && rect.width >= 180 && rect.height >= 120) {
      const buttonWidth = Math.min(92, (rect.width - padding * 2 - 10) / 2);
      const buttonHeight = 32;
      const buttonY = rect.y + rect.height - padding - buttonHeight;
      const retryX = centerX - buttonWidth - 5;
      const closeX = centerX + 5;

      this.appendDesktopActionButton(
        host,
        retryX,
        buttonY,
        buttonWidth,
        buttonHeight,
        '重试',
        accent,
        () => {
          const taskId = element.primaryTaskId || element.taskIds[0];
          window.dispatchEvent(
            new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
              detail: { taskId, anchorId: element.id },
            })
          );
        }
      );
      this.appendDesktopActionButton(
        host,
        closeX,
        buttonY,
        buttonWidth,
        buttonHeight,
        '关闭',
        '#7f1d1d',
        () => this.board.deleteFragment([element]),
        true
      );
    }
  }

  private appendDesktopActionButton(
    host: SVGGElement,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    color: string,
    action: () => void,
    secondary = false
  ): void {
    const button = createSvgElement('g');
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', label);
    button.setAttribute('tabindex', '0');
    button.style.cursor = 'pointer';
    button.style.pointerEvents = 'auto';

    const buttonRect = createSvgElement('rect');
    buttonRect.setAttribute('x', String(x));
    buttonRect.setAttribute('y', String(y));
    buttonRect.setAttribute('width', String(width));
    buttonRect.setAttribute('height', String(height));
    buttonRect.setAttribute('rx', '7');
    buttonRect.setAttribute('fill', secondary ? '#ffffff' : color);
    buttonRect.setAttribute('stroke', color);
    buttonRect.setAttribute('stroke-width', '1');
    button.appendChild(buttonRect);

    const buttonText = createSvgElement('text');
    buttonText.setAttribute('x', String(x + width / 2));
    buttonText.setAttribute('y', String(y + height / 2));
    buttonText.setAttribute('text-anchor', 'middle');
    buttonText.setAttribute('dominant-baseline', 'middle');
    buttonText.setAttribute('fill', secondary ? color : '#ffffff');
    buttonText.setAttribute(
      'font-family',
      '-apple-system, BlinkMacSystemFont, sans-serif'
    );
    buttonText.setAttribute('font-size', '12');
    buttonText.setAttribute('font-weight', '600');
    buttonText.textContent = label;
    button.appendChild(buttonText);

    button.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    host.appendChild(button);
  }

  private createForeignObject(
    element: PlaitImageGenerationAnchor,
    g: SVGGElement
  ): void {
    const rect = RectangleClient.getRectangleByPoints(element.points);

    this.foreignObject = createSvgElement('foreignObject');
    this.foreignObject.setAttribute('x', String(rect.x));
    this.foreignObject.setAttribute('y', String(rect.y));
    this.foreignObject.setAttribute('width', String(rect.width));
    this.foreignObject.setAttribute('height', String(rect.height));
    this.foreignObject.style.overflow = 'visible';
    this.foreignObject.style.pointerEvents = 'auto';

    this.htmlContainer = document.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'div'
    ) as HTMLElement;
    this.htmlContainer.className = 'image-generation-anchor-host';
    this.htmlContainer.style.cssText = `
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      display: block;
      pointer-events: auto;
      overflow: visible;
    `;

    this.foreignObject.appendChild(this.htmlContainer);
    g.appendChild(this.foreignObject);
  }

  private updateForeignObject(element: PlaitImageGenerationAnchor): void {
    if (!this.foreignObject) {
      return;
    }

    const rect = RectangleClient.getRectangleByPoints(element.points);
    this.foreignObject.setAttribute('x', String(rect.x));
    this.foreignObject.setAttribute('y', String(rect.y));
    this.foreignObject.setAttribute('width', String(rect.width));
    this.foreignObject.setAttribute('height', String(rect.height));
  }

  private renderReact(
    element: PlaitImageGenerationAnchor,
    selected: boolean
  ): void {
    if (!this.htmlContainer) {
      return;
    }

    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.htmlContainer);
    }

    this.reactRoot.render(
      React.createElement(ImageGenerationAnchorContent, {
        board: this.board,
        element,
        selected,
      })
    );
  }

  destroy(): void {
    if (this.renderTimer != null) {
      window.clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }

    if (this.reactRoot) {
      const root = this.reactRoot;
      this.reactRoot = null;
      setTimeout(() => {
        try {
          root.unmount();
        } catch {
          // Ignore unmount failures during teardown.
        }
      }, 0);
    }

    this.foreignObject = null;
    this.htmlContainer = null;
    this.desktopFallback = null;
  }
}
