import React from 'react';
import { getMenuItemClassName, useHandleMenuItemClick } from './common';
import MenuItemContent from './menu-item-content';

const MenuItemLink = ({
  icon,
  shortcut,
  href,
  children,
  onSelect,
  className = '',
  selected,
  ...rest
}: {
  href: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  shortcut?: string;
  className?: string;
  selected?: boolean;
  onSelect?: (event: Event) => void;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
  const { title, ...anchorProps } = rest;
  const ariaLabel = anchorProps['aria-label'] ?? title;
  const handleClick = useHandleMenuItemClick(anchorProps.onClick, onSelect);

  return (
    <a
      {...anchorProps}
      href={href}
      target="_blank"
      rel="noreferrer"
      className={getMenuItemClassName(className, selected)}
      aria-label={ariaLabel}
      onClick={handleClick}
    >
      <MenuItemContent icon={icon} shortcut={shortcut}>
        {children}
      </MenuItemContent>
    </a>
  );
};

export default MenuItemLink;
MenuItemLink.displayName = 'MenuItemLink';
