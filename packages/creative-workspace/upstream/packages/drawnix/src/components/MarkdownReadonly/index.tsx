import React, { memo, useMemo, useSyncExternalStore } from 'react';
import {
  subscribeAssetMap,
  getAssetMapSnapshot,
} from '../../stores/asset-map-store';
import { AssetType } from '../../types/asset.types';
import { extractAssetIdFromUrl } from '../../utils/markdown-asset-embeds';
import {
  parseMarkdownImageAlt,
  parseMarkdownImageTitle,
} from '../../utils/markdown-image-blocks';
import { RetryImage } from '../retry-image';
import './MarkdownReadonly.css';

export interface MarkdownReadonlyProps {
  markdown: string;
  className?: string;
  preserveSoftLineBreaks?: boolean;
  renderCodeBlock?: (
    code: string,
    language: string,
    key: string
  ) => React.ReactNode | undefined;
}

interface RenderOptions {
  preserveSoftLineBreaks: boolean;
  renderCodeBlock?: MarkdownReadonlyProps['renderCodeBlock'];
}

interface LineRead {
  line: string;
  start: number;
  next: number;
}

interface FenceStart {
  marker: '`' | '~';
  length: number;
  language: string;
}

interface ListItem {
  ordered: boolean;
  content: string;
  checked?: boolean;
}

interface LinkDestination {
  url: string;
  title: string;
  end: number;
}

interface ImageMeta {
  src: string;
  alt: string;
  title: string;
  end: number;
}

interface TableRead {
  node: React.ReactNode;
  next: number;
}

const BLOCK_START_PATTERNS = [
  /^\s{0,3}#{1,6}\s+/,
  /^\s{0,3}(?:[-*+]\s+|\d+\.\s+)/,
  /^\s{0,3}>/,
  /^\s{0,3}(?:---+|\*\*\*+|___+)\s*$/,
];
const SCRIPT_URL_SCHEME = ['java', 'script:'].join('');
const VBSCRIPT_URL_SCHEME = ['vb', 'script:'].join('');

function joinClassNames(...names: Array<string | undefined>): string {
  return names.filter(Boolean).join(' ');
}

function readLineAt(markdown: string, offset: number): LineRead | null {
  if (offset >= markdown.length) {
    return null;
  }

  const newlineIndex = markdown.indexOf('\n', offset);
  const rawEnd = newlineIndex === -1 ? markdown.length : newlineIndex;
  const lineEnd =
    rawEnd > offset && markdown.charCodeAt(rawEnd - 1) === 13
      ? rawEnd - 1
      : rawEnd;

  return {
    line: markdown.slice(offset, lineEnd),
    start: offset,
    next: newlineIndex === -1 ? markdown.length : newlineIndex + 1,
  };
}

function isBlankLine(line: string): boolean {
  return /^\s*$/.test(line);
}

function parseFenceStart(line: string): FenceStart | null {
  const match = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/.exec(line);
  if (!match) {
    return null;
  }

  const fence = match[1];
  return {
    marker: fence[0] as '`' | '~',
    length: fence.length,
    language: (match[2] || '').trim().toLowerCase(),
  };
}

function isFenceClose(line: string, fence: FenceStart): boolean {
  const escapedMarker = fence.marker === '`' ? '`' : '~';
  const pattern = new RegExp(
    `^\\s{0,3}${escapedMarker}{${fence.length},}\\s*$`
  );
  return pattern.test(line);
}

function parseHeading(line: string): { level: number; content: string } | null {
  const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (!match) {
    return null;
  }

  return {
    level: match[1].length,
    content: match[2],
  };
}

function parseListItem(line: string): ListItem | null {
  const unordered = /^\s{0,3}[-*+]\s+(.+)$/.exec(line);
  if (unordered) {
    const task = parseTaskListContent(unordered[1]);
    return { ordered: false, ...task };
  }

  const ordered = /^\s{0,3}\d+\.\s+(.+)$/.exec(line);
  if (ordered) {
    const task = parseTaskListContent(ordered[1]);
    return { ordered: true, ...task };
  }

  return null;
}

function parseTaskListContent(content: string): {
  content: string;
  checked?: boolean;
} {
  const task = /^\[( |x|X)\]\s+(.+)$/.exec(content);
  if (!task) {
    return { content };
  }

  return {
    content: task[2],
    checked: task[1].toLowerCase() === 'x',
  };
}

function stripBlockquote(line: string): string | null {
  const match = /^\s{0,3}>\s?(.*)$/.exec(line);
  return match ? match[1] : null;
}

function isHorizontalRule(line: string): boolean {
  return /^\s{0,3}(?:---+|\*\*\*+|___+)\s*$/.test(line);
}

function isBlockStart(line: string): boolean {
  if (parseFenceStart(line)) {
    return true;
  }
  return BLOCK_START_PATTERNS.some((pattern) => pattern.test(line));
}

function appendTextWithBreaks(
  nodes: React.ReactNode[],
  text: string,
  preserveSoftLineBreaks: boolean,
  keyPrefix: string
): void {
  if (text.indexOf('\n') === -1) {
    nodes.push(text);
    return;
  }

  let start = 0;
  let breakIndex = 0;

  while (start < text.length) {
    const newlineIndex = text.indexOf('\n', start);
    if (newlineIndex === -1) {
      nodes.push(text.slice(start));
      return;
    }

    const hasHardBreak =
      newlineIndex >= 2 &&
      text.charCodeAt(newlineIndex - 1) === 32 &&
      text.charCodeAt(newlineIndex - 2) === 32;
    const textEnd = hasHardBreak ? newlineIndex - 2 : newlineIndex;

    if (textEnd > start) {
      nodes.push(text.slice(start, textEnd));
    }

    if (hasHardBreak || preserveSoftLineBreaks) {
      nodes.push(<br key={`${keyPrefix}-br-${breakIndex}`} />);
    } else {
      nodes.push(' ');
    }

    breakIndex += 1;
    start = newlineIndex + 1;
  }
}

function findClosingDelimiter(
  text: string,
  delimiter: string,
  from: number
): number {
  let cursor = from;

  while (cursor < text.length) {
    const found = text.indexOf(delimiter, cursor);
    if (found === -1) {
      return -1;
    }
    if (found === 0 || text.charCodeAt(found - 1) !== 92) {
      return found;
    }
    cursor = found + delimiter.length;
  }

  return -1;
}

function findClosingBracket(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === ']' && (i === 0 || text.charCodeAt(i - 1) !== 92)) {
      return i;
    }
  }
  return -1;
}

function parseLinkDestination(
  text: string,
  openParenIndex: number
): LinkDestination | null {
  let cursor = openParenIndex + 1;
  let quote: string | null = null;
  let nestedParens = 0;

  while (cursor < text.length) {
    const char = text[cursor];

    if (text.charCodeAt(cursor) === 92) {
      cursor += 2;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      cursor += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      cursor += 1;
      continue;
    }

    if (char === '(') {
      nestedParens += 1;
      cursor += 1;
      continue;
    }

    if (char === ')') {
      if (nestedParens === 0) {
        const raw = text.slice(openParenIndex + 1, cursor).trim();
        const parsed = splitUrlAndTitle(raw);
        return {
          ...parsed,
          end: cursor,
        };
      }
      nestedParens -= 1;
    }

    cursor += 1;
  }

  return null;
}

function splitUrlAndTitle(raw: string): { url: string; title: string } {
  if (!raw) {
    return { url: '', title: '' };
  }

  if (raw[0] === '<') {
    const closeIndex = raw.indexOf('>');
    if (closeIndex > 0) {
      return {
        url: raw.slice(1, closeIndex).trim(),
        title: stripOptionalTitle(raw.slice(closeIndex + 1).trim()),
      };
    }
  }

  const whitespace = /\s/.exec(raw);
  if (!whitespace) {
    return { url: raw, title: '' };
  }

  return {
    url: raw.slice(0, whitespace.index).trim(),
    title: stripOptionalTitle(raw.slice(whitespace.index + 1).trim()),
  };
}

function stripOptionalTitle(raw: string): string {
  if (raw.length < 2) {
    return raw;
  }

  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return raw.slice(1, -1);
  }

  return raw;
}

function startsWithSchemeIgnoringControl(url: string, scheme: string): boolean {
  let schemeIndex = 0;

  for (let i = 0; i < url.length; i += 1) {
    const code = url.charCodeAt(i);
    if (code <= 32 || code === 127) {
      continue;
    }

    if (url[i].toLowerCase() !== scheme[schemeIndex]) {
      return false;
    }

    schemeIndex += 1;
    if (schemeIndex === scheme.length) {
      return true;
    }
  }

  return false;
}

function sanitizeLinkUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  if (
    startsWithSchemeIgnoringControl(trimmed, SCRIPT_URL_SCHEME) ||
    startsWithSchemeIgnoringControl(trimmed, VBSCRIPT_URL_SCHEME) ||
    startsWithSchemeIgnoringControl(trimmed, 'data:')
  ) {
    return null;
  }

  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(trimmed)?.[0].toLowerCase();
  if (
    scheme &&
    scheme !== 'http:' &&
    scheme !== 'https:' &&
    scheme !== 'mailto:'
  ) {
    return null;
  }

  return trimmed;
}

function sanitizeImageUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  if (
    startsWithSchemeIgnoringControl(trimmed, SCRIPT_URL_SCHEME) ||
    startsWithSchemeIgnoringControl(trimmed, VBSCRIPT_URL_SCHEME)
  ) {
    return null;
  }

  if (startsWithSchemeIgnoringControl(trimmed, 'data:')) {
    return /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(trimmed)
      ? trimmed
      : null;
  }

  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(trimmed)?.[0].toLowerCase();
  if (
    scheme &&
    scheme !== 'http:' &&
    scheme !== 'https:' &&
    scheme !== 'blob:' &&
    scheme !== 'asset:'
  ) {
    return null;
  }

  return trimmed;
}

function parseImageAt(text: string, cursor: number): ImageMeta | null {
  if (text[cursor] !== '!' || text[cursor + 1] !== '[') {
    return null;
  }

  const closeBracket = findClosingBracket(text, cursor + 2);
  if (closeBracket === -1 || text[closeBracket + 1] !== '(') {
    return null;
  }

  const destination = parseLinkDestination(text, closeBracket + 1);
  if (!destination) {
    return null;
  }

  return {
    alt: text.slice(cursor + 2, closeBracket),
    src: destination.url,
    title: destination.title,
    end: destination.end,
  };
}

function joinLines(lines: string[]): string {
  return lines.length === 1 ? lines[0] : lines.join('\n');
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text.charCodeAt(i) === 92; i -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function trimTableEdgePipe(line: string): string {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith('|') && !isEscaped(trimmed, trimmed.length - 1)) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  const row = trimTableEdgePipe(line);
  let start = 0;

  for (let i = 0; i < row.length; i += 1) {
    if (row[i] === '|' && !isEscaped(row, i)) {
      cells.push(row.slice(start, i).replace(/\\\|/g, '|').trim());
      start = i + 1;
    }
  }

  cells.push(row.slice(start).replace(/\\\|/g, '|').trim());
  return cells;
}

function parseTableAlignments(
  line: string
): Array<'left' | 'center' | 'right' | undefined> | null {
  const cells = splitTableRow(line);
  if (cells.length === 0) {
    return null;
  }

  const alignments: Array<'left' | 'center' | 'right' | undefined> = [];
  for (const cell of cells) {
    const compact = cell.replace(/\s+/g, '');
    if (!/^:?-{3,}:?$/.test(compact)) {
      return null;
    }

    if (compact.startsWith(':') && compact.endsWith(':')) {
      alignments.push('center');
    } else if (compact.endsWith(':')) {
      alignments.push('right');
    } else if (compact.startsWith(':')) {
      alignments.push('left');
    } else {
      alignments.push(undefined);
    }
  }

  return alignments;
}

function isTableCandidateLine(line: string): boolean {
  return line.includes('|') && !parseFenceStart(line);
}

function isTableStartAt(markdown: string, offset: number): boolean {
  const header = readLineAt(markdown, offset);
  if (!header || !isTableCandidateLine(header.line)) {
    return false;
  }

  const delimiter = readLineAt(markdown, header.next);
  if (!delimiter) {
    return false;
  }

  const alignments = parseTableAlignments(delimiter.line);
  return (
    !!alignments && splitTableRow(header.line).length === alignments.length
  );
}

function readTableBlock(
  markdown: string,
  headerLine: string,
  afterHeaderOffset: number,
  keyBase: string,
  options: RenderOptions
): TableRead | null {
  if (!isTableCandidateLine(headerLine)) {
    return null;
  }

  const delimiter = readLineAt(markdown, afterHeaderOffset);
  if (!delimiter) {
    return null;
  }

  const alignments = parseTableAlignments(delimiter.line);
  if (!alignments) {
    return null;
  }

  const headers = splitTableRow(headerLine);
  if (headers.length === 0 || headers.length !== alignments.length) {
    return null;
  }

  const rows: string[][] = [];
  let cursor = delimiter.next;
  while (cursor < markdown.length) {
    const next = readLineAt(markdown, cursor);
    if (!next || isBlankLine(next.line) || !isTableCandidateLine(next.line)) {
      break;
    }

    const cells = splitTableRow(next.line);
    rows.push(cells);
    cursor = next.next;
  }

  const renderCell = (cell: string, cellIndex: number, rowKey: string) => {
    const align = alignments[cellIndex];
    const style = align ? { textAlign: align } : undefined;
    return {
      style,
      content: renderInline(cell, options, `${rowKey}-cell-${cellIndex}`),
    };
  };

  return {
    next: cursor,
    node: (
      <div key={keyBase} className="markdown-readonly__table-wrap">
        <table className="markdown-readonly__table">
          <thead>
            <tr>
              {headers.map((cell, cellIndex) => {
                const rendered = renderCell(cell, cellIndex, `${keyBase}-head`);
                return (
                  <th key={`${keyBase}-th-${cellIndex}`} style={rendered.style}>
                    {rendered.content}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${keyBase}-tr-${rowIndex}`}>
                {alignments.map((_, cellIndex) => {
                  const rendered = renderCell(
                    row[cellIndex] ?? '',
                    cellIndex,
                    `${keyBase}-row-${rowIndex}`
                  );
                  return (
                    <td
                      key={`${keyBase}-td-${rowIndex}-${cellIndex}`}
                      style={rendered.style}
                    >
                      {rendered.content}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  };
}

function renderInline(
  text: string,
  options: RenderOptions,
  keyPrefix: string,
  depth = 0
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let textStart = 0;
  let nodeIndex = 0;

  const flushText = (end: number) => {
    if (end <= textStart) {
      return;
    }
    appendTextWithBreaks(
      nodes,
      text.slice(textStart, end),
      options.preserveSoftLineBreaks,
      `${keyPrefix}-text-${nodeIndex}`
    );
    nodeIndex += 1;
  };

  while (cursor < text.length) {
    const char = text[cursor];

    if (char === '`') {
      const close = findClosingDelimiter(text, '`', cursor + 1);
      if (close !== -1) {
        flushText(cursor);
        nodes.push(
          <code
            key={`${keyPrefix}-code-${nodeIndex}`}
            className="markdown-readonly__inline-code"
          >
            {text.slice(cursor + 1, close)}
          </code>
        );
        nodeIndex += 1;
        cursor = close + 1;
        textStart = cursor;
        continue;
      }
    }

    if (char === '!' && text[cursor + 1] === '[') {
      const image = parseImageAt(text, cursor);
      if (image) {
        flushText(cursor);
        nodes.push(
          <MarkdownReadonlyImage
            key={`${keyPrefix}-img-${nodeIndex}`}
            src={image.src}
            alt={image.alt}
            title={image.title}
          />
        );
        nodeIndex += 1;
        cursor = image.end + 1;
        textStart = cursor;
        continue;
      }
    }

    if (char === '[' && depth < 6) {
      const closeBracket = findClosingBracket(text, cursor + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const destination = parseLinkDestination(text, closeBracket + 1);
        if (destination) {
          flushText(cursor);
          const label = text.slice(cursor + 1, closeBracket);
          const children = renderInline(
            label,
            options,
            `${keyPrefix}-link-${nodeIndex}`,
            depth + 1
          );
          const href = sanitizeLinkUrl(destination.url);

          nodes.push(
            href ? (
              <a
                key={`${keyPrefix}-a-${nodeIndex}`}
                href={href}
                title={destination.title || undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ) : (
              <span key={`${keyPrefix}-bad-a-${nodeIndex}`}>{children}</span>
            )
          );
          nodeIndex += 1;
          cursor = destination.end + 1;
          textStart = cursor;
          continue;
        }
      }
    }

    if (text.startsWith('~~', cursor) && depth < 6) {
      const close = findClosingDelimiter(text, '~~', cursor + 2);
      if (close !== -1) {
        flushText(cursor);
        nodes.push(
          <del key={`${keyPrefix}-del-${nodeIndex}`}>
            {renderInline(
              text.slice(cursor + 2, close),
              options,
              `${keyPrefix}-del-${nodeIndex}`,
              depth + 1
            )}
          </del>
        );
        nodeIndex += 1;
        cursor = close + 2;
        textStart = cursor;
        continue;
      }
    }

    if ((char === '*' || char === '_') && depth < 6) {
      const doubleDelimiter = `${char}${char}`;
      if (text.startsWith(doubleDelimiter, cursor)) {
        const close = findClosingDelimiter(text, doubleDelimiter, cursor + 2);
        if (close !== -1) {
          flushText(cursor);
          nodes.push(
            <strong key={`${keyPrefix}-strong-${nodeIndex}`}>
              {renderInline(
                text.slice(cursor + 2, close),
                options,
                `${keyPrefix}-strong-${nodeIndex}`,
                depth + 1
              )}
            </strong>
          );
          nodeIndex += 1;
          cursor = close + 2;
          textStart = cursor;
          continue;
        }
      }

      const close = findClosingDelimiter(text, char, cursor + 1);
      if (close !== -1) {
        flushText(cursor);
        nodes.push(
          <em key={`${keyPrefix}-em-${nodeIndex}`}>
            {renderInline(
              text.slice(cursor + 1, close),
              options,
              `${keyPrefix}-em-${nodeIndex}`,
              depth + 1
            )}
          </em>
        );
        nodeIndex += 1;
        cursor = close + 1;
        textStart = cursor;
        continue;
      }
    }

    cursor += 1;
  }

  flushText(text.length);
  return nodes;
}

function renderCodeBlock(
  code: string,
  language: string,
  key: string,
  options: RenderOptions
): React.ReactNode {
  const custom = options.renderCodeBlock?.(code, language, key);
  if (custom !== undefined) {
    return custom;
  }

  return (
    <pre key={key} className="markdown-readonly__code-block">
      <code className={language ? `language-${language}` : undefined}>
        {code}
      </code>
    </pre>
  );
}

function renderBlocks(
  markdown: string,
  options: RenderOptions
): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  let cursor = 0;
  let blockIndex = 0;

  while (cursor < markdown.length) {
    const current = readLineAt(markdown, cursor);
    if (!current) {
      break;
    }
    cursor = current.next;

    if (isBlankLine(current.line)) {
      continue;
    }

    const fence = parseFenceStart(current.line);
    if (fence) {
      const codeStart = cursor;
      let codeEnd = markdown.length;
      let scan = cursor;
      let foundClose = false;

      while (scan < markdown.length) {
        const candidate = readLineAt(markdown, scan);
        if (!candidate) {
          break;
        }

        if (isFenceClose(candidate.line, fence)) {
          codeEnd = candidate.start;
          cursor = candidate.next;
          foundClose = true;
          break;
        }

        scan = candidate.next;
      }

      if (!foundClose) {
        cursor = markdown.length;
      }

      blocks.push(
        renderCodeBlock(
          markdown.slice(codeStart, codeEnd),
          fence.language,
          `md-block-${blockIndex}`,
          options
        )
      );
      blockIndex += 1;
      continue;
    }

    const table = readTableBlock(
      markdown,
      current.line,
      cursor,
      `md-block-${blockIndex}`,
      options
    );
    if (table) {
      blocks.push(table.node);
      cursor = table.next;
      blockIndex += 1;
      continue;
    }

    const heading = parseHeading(current.line);
    if (heading) {
      const Tag = `h${heading.level}` as keyof JSX.IntrinsicElements;
      blocks.push(
        <Tag key={`md-block-${blockIndex}`}>
          {renderInline(heading.content, options, `md-block-${blockIndex}`)}
        </Tag>
      );
      blockIndex += 1;
      continue;
    }

    if (isHorizontalRule(current.line)) {
      blocks.push(<hr key={`md-block-${blockIndex}`} />);
      blockIndex += 1;
      continue;
    }

    const quote = stripBlockquote(current.line);
    if (quote !== null) {
      const lines = [quote];

      while (cursor < markdown.length) {
        const next = readLineAt(markdown, cursor);
        if (!next) {
          break;
        }
        const nextQuote = stripBlockquote(next.line);
        if (nextQuote === null) {
          break;
        }
        lines.push(nextQuote);
        cursor = next.next;
      }

      blocks.push(
        <blockquote key={`md-block-${blockIndex}`}>
          <p>
            {renderInline(joinLines(lines), options, `md-block-${blockIndex}`)}
          </p>
        </blockquote>
      );
      blockIndex += 1;
      continue;
    }

    const listItem = parseListItem(current.line);
    if (listItem) {
      const items = [listItem];

      while (cursor < markdown.length) {
        const next = readLineAt(markdown, cursor);
        if (!next) {
          break;
        }

        const nextItem = parseListItem(next.line);
        if (!nextItem || nextItem.ordered !== listItem.ordered) {
          break;
        }

        items.push(nextItem);
        cursor = next.next;
      }

      const ListTag = listItem.ordered ? 'ol' : 'ul';
      const keyBase = `md-block-${blockIndex}`;
      blocks.push(
        <ListTag key={keyBase}>
          {items.map((item, itemIndex) => (
            <li key={`${keyBase}-li-${itemIndex}`}>
              {item.checked !== undefined ? (
                <input
                  className="markdown-readonly__task-checkbox"
                  type="checkbox"
                  checked={item.checked}
                  readOnly
                  disabled
                />
              ) : null}
              {renderInline(
                item.content,
                options,
                `${keyBase}-li-${itemIndex}`
              )}
            </li>
          ))}
        </ListTag>
      );
      blockIndex += 1;
      continue;
    }

    const paragraphLines = [current.line];
    while (cursor < markdown.length) {
      const next = readLineAt(markdown, cursor);
      if (
        !next ||
        isBlankLine(next.line) ||
        isBlockStart(next.line) ||
        isTableStartAt(markdown, cursor)
      ) {
        break;
      }

      paragraphLines.push(next.line);
      cursor = next.next;
    }

    blocks.push(
      <p key={`md-block-${blockIndex}`}>
        {renderInline(
          joinLines(paragraphLines),
          options,
          `md-block-${blockIndex}`
        )}
      </p>
    );
    blockIndex += 1;
  }

  return blocks;
}

function normalizeImageAlt(alt: string, src: string): string {
  const assetId = extractAssetIdFromUrl(src);
  if (!assetId) {
    return alt || '图片';
  }

  const parsed = parseMarkdownImageAlt(alt);
  return parsed.label || alt || '素材图片';
}

function MarkdownReadonlyImage({
  src,
  alt,
  title,
}: {
  src: string;
  alt: string;
  title: string;
}) {
  const safeSrc = sanitizeImageUrl(src);
  const normalizedAlt = normalizeImageAlt(alt, src);
  const titleMeta = parseMarkdownImageTitle(title);
  const titleText = titleMeta.caption || title || undefined;
  const style = {
    width: titleMeta.width ? `${titleMeta.width}px` : undefined,
    height: titleMeta.height ? `${titleMeta.height}px` : undefined,
  };

  if (!safeSrc) {
    return (
      <span className="markdown-readonly__media-placeholder">
        {normalizedAlt}
      </span>
    );
  }

  const assetId = extractAssetIdFromUrl(safeSrc);
  if (assetId) {
    return (
      <MarkdownReadonlyAssetImage
        assetId={assetId}
        alt={normalizedAlt}
        title={titleText}
        style={style}
      />
    );
  }

  return (
    <RetryImage
      className="markdown-readonly__image"
      src={safeSrc}
      alt={normalizedAlt}
      title={titleText}
      style={style}
      showSkeleton={false}
    />
  );
}

function MarkdownReadonlyAssetImage({
  assetId,
  alt,
  title,
  style,
}: {
  assetId: string;
  alt: string;
  title?: string;
  style: React.CSSProperties;
}) {
  const assetMap = useSyncExternalStore(subscribeAssetMap, getAssetMapSnapshot);
  const asset = assetMap.get(assetId);

  if (!asset) {
    if (assetMap.size === 0) {
      return (
        <span className="markdown-readonly__media-loading" style={style} />
      );
    }

    return (
      <span className="markdown-readonly__media-placeholder" style={style}>
        素材不存在或已删除
      </span>
    );
  }

  if (asset.type !== AssetType.IMAGE) {
    return (
      <span className="markdown-readonly__media-placeholder" style={style}>
        {asset.name || alt}
      </span>
    );
  }

  const safeSrc = sanitizeImageUrl(asset.url);
  if (!safeSrc) {
    return (
      <span className="markdown-readonly__media-placeholder" style={style}>
        {asset.name || alt}
      </span>
    );
  }

  return (
    <RetryImage
      className="markdown-readonly__image"
      src={safeSrc}
      alt={alt || asset.name || '素材图片'}
      title={title}
      style={style}
      showSkeleton={false}
    />
  );
}

export const MarkdownReadonly = memo(function MarkdownReadonly({
  markdown,
  className,
  preserveSoftLineBreaks = true,
  renderCodeBlock: customCodeBlock,
}: MarkdownReadonlyProps) {
  const rendered = useMemo(
    () =>
      renderBlocks(markdown || '', {
        preserveSoftLineBreaks,
        renderCodeBlock: customCodeBlock,
      }),
    [customCodeBlock, markdown, preserveSoftLineBreaks]
  );

  return (
    <div className={joinClassNames('markdown-readonly', className)}>
      {rendered}
    </div>
  );
});

export default MarkdownReadonly;
