import React, { useLayoutEffect, useRef } from 'react';
import { getAssistantAccount } from '../../services/assistant-account';
import { formatGenerationErrorReport } from '../../utils/generation-error-details';

export type FailureRows = readonly (readonly [string, string])[];
const NS = 'http://www.w3.org/2000/svg';

/** SVG text remains visible in native WebKit, where foreignObject can disappear. */
export function getNativeFailureLayout(rows: FailureRows, width: number) {
  const lines: { text: string; y: number; label: boolean }[] = [];
  const available = Math.max(100, width - 32);
  let y = 44;
  for (const [label, value] of rows) {
    lines.push({ text: label, y, label: true });
    y += 18;
    let line = '';
    let pixels = 0;
    for (const char of value.replace(/\r\n?/g, '\n')) {
      const size = /[^\x00-\x7f]/.test(char) ? 12 : 7.5;
      if (char === '\n' || pixels + size > available) {
        lines.push({ text: line, y, label: false });
        y += 18;
        line = '';
        pixels = 0;
      }
      if (char !== '\n') { line += char; pixels += size; }
    }
    lines.push({ text: line, y, label: false });
    y += 26;
  }
  return { lines, height: y };
}

export function createNativeFailureDetails(rows: FailureRows, width: number) {
  const group = document.createElementNS(NS, 'g');
  group.setAttribute('class', 'native-generation-failure-details');
  group.setAttribute('font-family', 'system-ui, sans-serif');
  const layout = getNativeFailureLayout(rows, width);
  for (const line of layout.lines) {
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', '16');
    text.setAttribute('y', String(line.y));
    text.setAttribute('font-size', line.label ? '10' : '12');
    text.setAttribute('fill', line.label ? '#64748b' : '#9c3b30');
    text.textContent = line.text;
    group.appendChild(text);
  }
  const button = document.createElementNS(NS, 'g');
  button.setAttribute('role', 'button');
  button.setAttribute('aria-label', '复制 全部错误信息');
  button.setAttribute('tabindex', '0');
  button.style.cursor = 'pointer';
  const rect = document.createElementNS(NS, 'rect');
  for (const [key, value] of Object.entries({ x: '16', y: '0', width: '112', height: '26', rx: '5', fill: '#ffffff', stroke: '#e5caca' })) rect.setAttribute(key, value);
  const label = document.createElementNS(NS, 'text');
  for (const [key, value] of Object.entries({ x: '72', y: '17', 'text-anchor': 'middle', 'font-size': '11', fill: '#9c3b30' })) label.setAttribute(key, value);
  label.textContent = '复制错误信息';
  button.append(rect, label);
  const copy = async () => {
    try {
      const report = formatGenerationErrorReport(rows);
      const native = getAssistantAccount()?.copyText;
      if (native) await native(report);
      else await navigator.clipboard.writeText(report);
      label.textContent = '已复制';
    } catch { label.textContent = '复制失败，请重试'; }
  };
  button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); void copy(); });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); void copy(); }
  });
  for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) button.addEventListener(name, (event) => event.stopPropagation());
  group.appendChild(button);
  return group;
}

export function NativeGenerationFailureDetails({ rows, width }: { rows: FailureRows; width: number }) {
  const host = useRef<SVGGElement>(null);
  // Preserve copy feedback across unrelated renders with identical diagnostic values.
  const signature = JSON.stringify(rows);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    node.replaceChildren(createNativeFailureDetails(JSON.parse(signature), width));
    return () => node.replaceChildren();
  }, [signature, width]);
  return <g ref={host} />;
}
