import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const tree = ts.createSourceFile('popup-toolbar.tsx', readFileSync(resolve(__dirname, 'popup-toolbar.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'updatePopupToolbarPosition') {
    callback = ((node.initializer as ts.CallExpression).arguments[0]).getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
const code = ts.transpileModule(`exports.position = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
function position(top: number, inputs: Array<{left: number; right: number; top: number; bottom: number}>) {
  let placement = 'top';
  let reference: {x: number; y: number} | undefined;
  const exports = {} as { position: () => void };
  runInNewContext(code, {
    exports, open: true, movingOrDragging: false, board: {},
    getSelectedElements: () => [{ generationNode: {} }],
    getRectangleByElements: () => ({}),
    RectangleClient: { getPoints: () => [[923, top], [1078, top + 101]] },
    toScreenPointFromHostPoint: (_: unknown, p: unknown) => p,
    toHostPointFromViewBoxPoint: (_: unknown, p: unknown) => p,
    PlaitBoard: { getHost: () => ({getBoundingClientRect: () => ({top: 44, left: 60, right: 1706})}) },
    PlaitDrawElement: { isImage: () => false },
    document: { querySelectorAll: () => inputs.map(r => ({getBoundingClientRect: () => ({...r, width: r.right-r.left, height: r.bottom-r.top})})) },
    toolbarRef: { current: {getBoundingClientRect: () => ({height: 36, width: 224})} },
    refs: {setPositionReference: (r: {getBoundingClientRect: () => {x: number; y: number}}) => { reference = r.getBoundingClientRect(); }},
    setPopupToolbarPlacement: (fn: (p: string) => string) => {placement = fn(placement);},
    setSelectionRect: vi.fn(), setToolbarRect: vi.fn(),
  });
  exports.position();
  return {placement, reference: reference!};
}

describe('desktop canvas action toolbar boundaries', () => {
  it('places actions below a card beside the desktop header', () => {
    const result = position(60, []);
    expect(result.placement).toBe('bottom');
    expect(result.reference.y).toBe(161);
  });
  it('keeps every action outside a nearby card editor at reduced zoom', () => {
    const result = position(60, [{left: 1095, right: 1534, top: 104, bottom: 412}]);
    expect(result.placement).toBe('bottom');
    expect(result.reference.x + 224 / 2).toBeLessThanOrEqual(1095 - 12);
    expect(result.reference.x - 224 / 2).toBeGreaterThanOrEqual(60 + 16);
  });
  it('keeps an unobstructed toolbar centered above its selection', () => {
    const result = position(300, []);
    expect(result.placement).toBe('top');
    expect(result.reference).toMatchObject({x: 1000.5, y: 300});
  });
});
