/**
 * 可输入的下拉选择器
 * 支持从预设选项中选择，也支持自由输入
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';

export interface ComboOption {
  label: string;
  value: string;
}

export interface ComboOptionGroup {
  label: string;
  options: Array<string | ComboOption>;
}

type ComboInputOption = string | ComboOption | ComboOptionGroup;

export interface ComboInputProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboInputOption[];
  className?: string;
  placeholder?: string;
}

function normalizeOption(option: string | ComboOption): ComboOption {
  return typeof option === 'string' ? { label: option, value: option } : option;
}

function isOptionGroup(option: ComboInputOption): option is ComboOptionGroup {
  return typeof option !== 'string' && 'options' in option;
}

interface NormalizedOptionGroup {
  key: string;
  label?: string;
  options: ComboOption[];
}

const OPEN_INTERACTION_GUARD_MS = 180;

export const ComboInput: React.FC<ComboInputProps> = ({
  value,
  onChange,
  options,
  className = '',
  placeholder,
}) => {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ignoreOutsideUntilRef = useRef(0);

  const normalizedGroups: NormalizedOptionGroup[] = [];
  const ungroupedOptions: ComboOption[] = [];

  options.forEach((option, index) => {
    if (isOptionGroup(option)) {
      normalizedGroups.push({
        key: `group-${index}-${option.label}`,
        label: option.label,
        options: option.options.map(normalizeOption),
      });
      return;
    }
    ungroupedOptions.push(normalizeOption(option));
  });

  if (ungroupedOptions.length > 0) {
    normalizedGroups.unshift({
      key: 'ungrouped',
      options: ungroupedOptions,
    });
  }

  const normalized = normalizedGroups.flatMap((group) => group.options);
  const displayValue = normalized.find((option) => option.value === value)?.label || value;
  const query = value.trim().toLowerCase();
  const showAllOptions = !query || normalized.some((option) => option.value === value);
  const filteredGroups = showAllOptions
    ? normalizedGroups
    : normalizedGroups
        .map((group) => ({
          ...group,
          options: group.options.filter(
            (option) =>
              option.label.toLowerCase().includes(query) ||
              option.value.toLowerCase().includes(query)
          ),
        }))
        .filter((group) => group.options.length > 0);

  const openMenu = useCallback(() => {
    ignoreOutsideUntilRef.current = Date.now() + OPEN_INTERACTION_GUARD_MS;
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (Date.now() < ignoreOutsideUntilRef.current) {
        return;
      }
      if (
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const updateMenuPosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 2;
      const viewportPadding = 12;
      const preferredMaxHeight = 240;
      const minUsableHeight = 80;
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding);
      const spaceAbove = Math.max(0, rect.top - viewportPadding);
      const openAbove = spaceBelow < minUsableHeight && spaceAbove > spaceBelow;
      const availableSpace = openAbove ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(
        minUsableHeight,
        Math.min(preferredMaxHeight, availableSpace)
      );
      const top = openAbove
        ? Math.max(viewportPadding, rect.top - gap - maxHeight)
        : Math.min(
            rect.bottom + gap,
            window.innerHeight - viewportPadding - maxHeight
          );
      setMenuStyle({
        position: 'fixed',
        top,
        left: rect.left,
        width: rect.width,
        maxHeight,
      });
    };
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, filteredGroups.length]);

  const handleSelect = useCallback(
    (option: ComboOption) => {
      onChange(option.value);
      setOpen(false);
      inputRef.current?.blur();
    },
    [onChange]
  );

  return (
    <div className={`va-combo ${className}`} ref={containerRef}>
      <div className="va-combo-trigger" onClick={openMenu}>
        <input
          ref={inputRef}
          className="va-combo-input"
          value={displayValue}
          onChange={(event) => {
            onChange(event.target.value);
            openMenu();
          }}
          onFocus={openMenu}
          placeholder={placeholder}
        />
        {value && (
          <span
            className="va-combo-clear"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onChange('');
              inputRef.current?.focus();
            }}
          >
            ×
          </span>
        )}
        <span className="va-combo-arrow">▾</span>
      </div>
      {open && filteredGroups.length > 0 && ReactDOM.createPortal(
        <div className="va-combo-menu" ref={menuRef} style={menuStyle}>
          {filteredGroups.map((group) => (
            <div key={group.key} className="va-combo-group">
              {group.label && <div className="va-combo-group-label">{group.label}</div>}
              {group.options.map((option) => (
                <div
                  key={`${group.key}-${option.value}`}
                  className={`va-combo-option ${option.value === value ? 'selected' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    handleSelect(option);
                  }}
                >
                  {option.label}
                </div>
              ))}
            </div>
          ))}
        </div>,
        (document.getElementById('creative-portals') || document.body)
      )}
    </div>
  );
};
