import React from 'react';
import type { Placement } from '@floating-ui/react';
import { HoverCard } from '../hover';

interface HoverPopoverProps {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: Placement;
  sideOffset?: number;
  crossAxisOffset?: number;
  contentClassName?: string;
  closeDelay?: number;
}

export const HoverPopover: React.FC<HoverPopoverProps> = ({
  content,
  children,
  placement = 'bottom',
  sideOffset = 8,
  crossAxisOffset = 0,
  contentClassName,
  closeDelay = 100,
}) => {
  return (
    <HoverCard
      content={content}
      placement={placement}
      sideOffset={sideOffset}
      crossAxisOffset={crossAxisOffset}
      contentClassName={contentClassName || 'viewer-popover'}
      closeDelay={closeDelay}
    >
      {children}
    </HoverCard>
  );
};

export default HoverPopover;
