import React from 'react';
import { Tooltip as TDesignTooltip } from 'tdesign-react';
import { Z_INDEX } from '../../../constants/z-index';
import { hasUsableHoverContent, stripNativeHoverProps } from './hover-utils';

const DEFAULT_TOOLTIP_DELAY = 300;

export type HoverTipProps = React.ComponentProps<typeof TDesignTooltip> & {
  disabled?: boolean;
};

export function HoverTip({
  children,
  content,
  disabled = false,
  theme = 'light',
  delay = DEFAULT_TOOLTIP_DELAY,
  zIndex = Z_INDEX.TOOLTIP,
  ...rest
}: HoverTipProps) {
  if (disabled || !hasUsableHoverContent(content)) {
    return <>{stripNativeHoverProps(children)}</>;
  }

  return (
    <TDesignTooltip
      content={content}
      theme={theme}
      delay={delay}
      zIndex={zIndex}
      {...rest}
    >
      {stripNativeHoverProps(children)}
    </TDesignTooltip>
  );
}

export default HoverTip;
