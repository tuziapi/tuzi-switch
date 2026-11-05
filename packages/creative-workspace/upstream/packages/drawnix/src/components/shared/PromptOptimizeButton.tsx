import React, { useCallback, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { HoverTip } from './hover';
import {
  PromptOptimizeDialog,
  type PromptOptimizeDialogProps,
} from './PromptOptimizeDialog';

export interface PromptOptimizeButtonProps
  extends Omit<PromptOptimizeDialogProps, 'open' | 'onOpenChange'> {
  disabled?: boolean;
  className?: string;
  iconSize?: number;
  tooltipPlacement?: React.ComponentProps<typeof HoverTip>['placement'];
  tooltipContent?: React.ReactNode;
  onMouseDown?: React.MouseEventHandler<HTMLButtonElement>;
  onOpenChange?: (open: boolean) => void;
}

export const PromptOptimizeButton: React.FC<PromptOptimizeButtonProps> = ({
  disabled = false,
  className,
  iconSize = 16,
  tooltipPlacement = 'right',
  tooltipContent,
  language,
  onApply,
  onMouseDown,
  onOpenChange,
  ...dialogProps
}) => {
  const [open, setOpen] = useState(false);

  const setDialogOpen = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange]
  );

  const handleApply = useCallback(
    (prompt: string) => {
      onApply(prompt);
    },
    [onApply]
  );

  const label = language === 'zh' ? '提示词优化' : 'Prompt optimization';

  return (
    <>
      <HoverTip
        content={tooltipContent ?? label}
        placement={tooltipPlacement}
        disabled={disabled}
      >
        <button
          type="button"
          className={className || 'prompt-optimize-button'}
          disabled={disabled}
          onMouseDown={onMouseDown}
          onClick={() => setDialogOpen(true)}
          aria-label={label}
        >
          <Sparkles size={iconSize} />
        </button>
      </HoverTip>
      <PromptOptimizeDialog
        {...dialogProps}
        language={language}
        open={open}
        onOpenChange={setDialogOpen}
        onApply={handleApply}
      />
    </>
  );
};

export default PromptOptimizeButton;
