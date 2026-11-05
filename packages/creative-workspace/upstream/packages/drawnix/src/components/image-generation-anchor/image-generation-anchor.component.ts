import {
  ACTIVE_STROKE_WIDTH,
  OnContextChanged,
  PlaitBoard,
  PlaitPluginElementContext,
  RectangleClient,
} from '@plait/core';
import {
  ActiveGenerator,
  CommonElementFlavour,
  createActiveGenerator,
} from '@plait/common';
import type { PlaitImageGenerationAnchor } from '../../types/image-generation-anchor.types';
import { ImageGenerationAnchorGenerator } from './image-generation-anchor.generator';

export class ImageGenerationAnchorComponent
  extends CommonElementFlavour<PlaitImageGenerationAnchor, PlaitBoard>
  implements OnContextChanged<PlaitImageGenerationAnchor, PlaitBoard>
{
  private anchorGenerator!: ImageGenerationAnchorGenerator;
  private activeGenerator!: ActiveGenerator<PlaitImageGenerationAnchor>;
  private renderedG?: SVGGElement;

  initializeGenerator(): void {
    this.activeGenerator = createActiveGenerator(this.board, {
      getRectangle: (element: PlaitImageGenerationAnchor) => {
        return RectangleClient.getRectangleByPoints(element.points);
      },
      getStrokeWidth: () => ACTIVE_STROKE_WIDTH,
      getStrokeOpacity: () => 0.9,
      hasResizeHandle: () => false,
    });

    this.anchorGenerator = new ImageGenerationAnchorGenerator(this.board);
  }

  initialize(): void {
    super.initialize();
    this.initializeGenerator();

    const elementG = this.getElementG();
    this.renderedG = this.anchorGenerator.processDrawing(
      this.element,
      elementG,
      this.selected
    );

    this.activeGenerator.processDrawing(
      this.element,
      PlaitBoard.getActiveHost(this.board),
      { selected: this.selected }
    );
  }

  onContextChanged(
    value: PlaitPluginElementContext<PlaitImageGenerationAnchor, PlaitBoard>,
    previous: PlaitPluginElementContext<PlaitImageGenerationAnchor, PlaitBoard>
  ): void {
    const viewportChanged =
      value.board.viewport.zoom !== previous.board.viewport.zoom ||
      value.board.viewport.offsetX !== previous.board.viewport.offsetX ||
      value.board.viewport.offsetY !== previous.board.viewport.offsetY;

    if (value.element !== previous.element || value.hasThemeChanged) {
      if (this.renderedG) {
        this.anchorGenerator.updateDrawing(this.element, this.renderedG, this.selected);
      }

      this.activeGenerator.processDrawing(
        this.element,
        PlaitBoard.getActiveHost(this.board),
        { selected: this.selected }
      );
    } else if (viewportChanged && value.selected) {
      this.activeGenerator.processDrawing(
        this.element,
        PlaitBoard.getActiveHost(this.board),
        { selected: this.selected }
      );
    } else {
      const needUpdate = value.selected !== previous.selected;

      if (needUpdate && this.renderedG) {
        this.anchorGenerator.updateDrawing(this.element, this.renderedG, this.selected);
      }

      if (needUpdate || value.selected) {
        this.activeGenerator.processDrawing(
          this.element,
          PlaitBoard.getActiveHost(this.board),
          { selected: this.selected }
        );
      }
    }
  }

  destroy(): void {
    super.destroy();

    if (this.activeGenerator) {
      this.activeGenerator.destroy();
    }

    if (this.anchorGenerator) {
      this.anchorGenerator.destroy();
    }

    this.renderedG = undefined;
  }
}
