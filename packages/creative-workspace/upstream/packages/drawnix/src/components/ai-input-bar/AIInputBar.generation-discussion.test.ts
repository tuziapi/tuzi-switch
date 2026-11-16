import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Exercise the real editor transition callbacks, including desktop-only state.
const tree = ts.createSourceFile('AIInputBar.tsx', readFileSync(resolve(__dirname, 'AIInputBar.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let editor: ts.ObjectLiteralExpression;
let discussionBranch = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useGenerationNodeDraft') editor = node.arguments[2] as ts.ObjectLiteralExpression;
  if (ts.isIfStatement(node) && node.expression.getText(tree).includes("effectiveGenerationType === 'agent'") && node.expression.getText(tree).includes('discussionEnabled ||')) discussionBranch = node.expression.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
const callbacks = ['load', 'detach'].map(name => {
  const property = editor.properties.find(p => p.name?.getText(tree) === name) as ts.PropertyAssignment;
  return `exports.${name} = ${property.initializer.getText(tree)};`;
}).join('\n');
const code = ts.transpileModule(callbacks, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
function harness() {
  const oldDraft = { prompt: '讨论草稿', uploadedContent: [], knowledgeContextRefs: [] };
  const original = { type: 'image', model: 'original', modelRef: null, params: { size: '1K' }, count: 2 };
  const states = { enabled: true, reading: true, open: true };
  const exports = {} as { load: (data: any, starting: boolean) => void; detach: (boardChanged: boolean) => void };
  const context: Record<string, any> = {
    exports, inputPrefillSequenceRef: { current: 0 }, beforeGenerationNodeRef: { current: null },
    readCurrentTaskbarDraft: () => oldDraft, generationType: original.type, selectedModel: original.model,
    selectedModelRef: original.modelRef, selectedParams: original.params, selectedCount: original.count,
    canvasAssociationRefsRef: { current: [] }, discussionEnabled: true, discussionReading: true, discussionOpen: true,
    setDiscussionEnabled: (value: boolean) => { states.enabled = value; },
    setDiscussionReading: (value: boolean) => { states.reading = value; },
    setDiscussionOpen: (value: boolean) => { states.open = value; },
    detachTaskbarDraft: vi.fn(), selectedFrameRef: { current: null }, inputIntentRef: { current: undefined },
    promptRef: { current: oldDraft.prompt }, uploadedContentRef: { current: [] }, selectedContentRef: { current: [] },
    knowledgeContextRefsRef: { current: [] }, imageModels: [], videoModels: [],
    findExactSelectableModel: () => ({ id: 'saved' }), resolvePreferredModelSelection: () => ({ id: 'saved' }),
    getModelRefFromConfig: () => null, getSelectionKey: (id: string) => id,
    restoredModelSelectionRef: { current: null }, selectedParamsRef: { current: {} }, selectedParamScopeRef: { current: '' },
    unboundTaskbarDraftRef: { current: null }, unboundCanvasAssociationDraftRef: { current: [] },
  };
  for (const name of ['setInputIntent', 'setPrompt', 'setUploadedContent', 'setSelectedContent', 'applyCanvasAssociationRefs', 'setKnowledgeContextRefs', 'setGenerationType', 'setSelectedModel', 'setSelectedModelRef', 'setSelectedParams', 'setSelectedCount', 'applyTaskbarDraft']) context[name] = vi.fn();
  runInNewContext(code, context);
  return { context, exports, states, oldDraft };
}
const card = { generationType: 'image', prompt: '生成卡片草稿', references: [], params: { size: '2K' }, count: 1, model: 'saved' };
describe('desktop generation cards and attached discussion', () => {
  it('temporarily closes discussion, then restores its draft and display state', () => {
    const h = harness();
    h.exports.load(card, true);
    expect(h.states).toEqual({ enabled: false, reading: false, open: false });
    expect(h.context.promptRef.current).toBe(card.prompt);
    h.exports.load({ ...card, prompt: '第二张卡片' }, false);
    h.exports.detach(false);
    expect(h.states).toEqual({ enabled: true, reading: true, open: true });
    expect(h.context.applyTaskbarDraft).toHaveBeenCalledWith(h.oldDraft);
    expect(h.context.setSelectedModel).toHaveBeenLastCalledWith('original');
    expect(h.context.setSelectedCount).toHaveBeenLastCalledWith(2);
  });
  it('does not carry the previous board input into another board', () => {
    const h = harness();
    h.exports.load(card, true);
    h.exports.detach(true);
    expect(h.context.applyTaskbarDraft).not.toHaveBeenCalled();
    expect(h.context.promptRef.current).toBe('');
    expect(h.context.inputIntentRef.current).toBeUndefined();
    expect(h.context.beforeGenerationNodeRef.current).toBeNull();
  });
  it('never sends a card submission into the discussion planner', () => {
    expect(discussionBranch).not.toBe('');
    const run = (submittedGenerationNode: unknown, override?: unknown) => runInNewContext(discussionBranch, { override, submittedGenerationNode, restoreOriginalInputs: false, discussionEnabled: true, effectiveGenerationType: 'image', selectedSkillId: '', SKILL_AUTO_ID: 'auto' });
    expect(run({ id: 'card' })).toBe(false);
    expect(run(null)).toBe(true);
    expect(run(null, { intent: 'restore' })).toBe(false);
    expect(runInNewContext(discussionBranch, { override: undefined, submittedGenerationNode: null, restoreOriginalInputs: true, discussionEnabled: true, effectiveGenerationType: 'image', selectedSkillId: '', SKILL_AUTO_ID: 'auto' })).toBe(false);
  });
});
