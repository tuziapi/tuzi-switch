import React from 'react';

export function hasUsableHoverContent(content: React.ReactNode): boolean {
  if (content === null || content === undefined || content === false) {
    return false;
  }

  return typeof content !== 'string' || content.trim().length > 0;
}

export function stripNativeHoverProps(
  children: React.ReactNode
): React.ReactNode {
  if (!React.isValidElement(children)) {
    return children;
  }

  const childProps = children.props as Record<string, unknown>;
  const nextProps: Record<string, undefined> = {};

  if ('title' in childProps) {
    nextProps.title = undefined;
  }

  if ('data-tooltip' in childProps) {
    nextProps['data-tooltip'] = undefined;
  }

  if (Object.keys(nextProps).length === 0) {
    return children;
  }

  return React.cloneElement(children as React.ReactElement, nextProps);
}

export function composeHoverHandler<E>(
  original: ((event: E) => void) | undefined,
  next: (event: E) => void
) {
  return (event: E) => {
    original?.(event);
    next(event);
  };
}
