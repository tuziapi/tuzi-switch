import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import React, { useRef, useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import * as ts from 'typescript';

// Execute the production handler with React state; isolate network/storage only.
const source = readFileSync(
  resolve(__dirname, '../settings-dialog.tsx'),
  'utf8',
);
const tree = ts.createSourceFile(
  'settings.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let handler = '';
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(tree) === 'handleFetchModels'
  )
    handler = `const ${node.getText(tree)};`;
  ts.forEachChild(node, visit);
}
visit(tree);
if (!handler) throw new Error('Missing production model fetch handler');
const discover = vi.fn();
const persist = vi.fn();
const prompt = vi.fn();
const setError = vi.fn();
const compiled = ts.transpileModule(
  `
exports.Harness = function Harness({ pending = false, emptyKey = false }) {
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState('');
  const [discoveryDialogOpen, setDiscoveryDialogOpen] = useState(false);
  const modelFetchRef = useRef(null);
  const selectedProfile = { id: 'synthetic-profile', name: 'Synthetic', apiKey: emptyKey ? '' : 'tuzi-account:synthetic', baseUrl: 'https://synthetic.invalid/v1' };
  const hasPendingChanges = pending;
  const isPersisting = false;
  const isSelectedTuziProfile = false;
  const tuziApiEndpointOptions = [];
  const persistDrafts = persist;
  const updateProfile = () => {};
  ${handler}
  return <><button disabled={isFetchingModels} onClick={handleFetchModels}>{isFetchingModels ? '正在获取模型' : '获取模型'}</button>
    <button onClick={() => modelFetchRef.current?.abort()}>模拟关闭</button>
    {modelFetchError && <p role="alert">{modelFetchError}</p>}
    {discoveryDialogOpen && <div role="dialog">模型列表</div>}
  </>;
};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
const exports: {
  Harness?: React.FC<{ pending?: boolean; emptyKey?: boolean }>;
} = {};
runInNewContext(compiled, {
  exports,
  React,
  useState,
  useRef,
  AbortController,
  Error,
  persist,
  discoverProviderModels: discover,
  promptForApiKey: prompt,
  normalizeModelApiBaseUrl: (value: string) => value,
  TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://synthetic.invalid/v1',
  analytics: { trackUIInteraction: vi.fn() },
  runtimeModelDiscovery: { setError },
  MessagePlugin: { warning: vi.fn(), error: vi.fn() },
});
const Harness = exports.Harness!;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  persist.mockResolvedValue(true);
  discover.mockResolvedValue([]);
});

it('shows loading during save and ignores repeated clicks before discovery starts', async () => {
  const save = deferred<boolean>();
  persist.mockReturnValue(save.promise);
  render(<Harness pending />);
  const button = screen.getByRole('button', { name: '获取模型' });
  fireEvent.click(button);
  expect(
    screen
      .getByRole('button', { name: '正在获取模型' })
      .hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(button);
  expect(persist).toHaveBeenCalledOnce();
  expect(discover).not.toHaveBeenCalled();
  await act(async () => save.resolve(true));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(discover).toHaveBeenCalledOnce();
});

it('does not fetch after failed save and allows retry', async () => {
  persist.mockResolvedValueOnce(false);
  render(<Harness pending />);
  fireEvent.click(screen.getByRole('button', { name: '获取模型' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '获取模型' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  expect(discover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '获取模型' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
});

it('shows a persistent error and succeeds on retry', async () => {
  discover.mockRejectedValueOnce(new Error('合成网络故障'));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '获取模型' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    '合成网络故障',
  );
  fireEvent.click(screen.getByRole('button', { name: '获取模型' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('does not open a stale result after closing while discovery is pending', async () => {
  const result = deferred<unknown[]>();
  discover.mockReturnValue(result.promise);
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '获取模型' }));
  fireEvent.click(screen.getByRole('button', { name: '模拟关闭' }));
  await act(async () => result.resolve([]));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('releases loading when credential entry is cancelled', async () => {
  prompt.mockResolvedValueOnce(null);
  render(<Harness emptyKey />);
  fireEvent.click(screen.getByRole('button', { name: '获取模型' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '获取模型' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  expect(discover).not.toHaveBeenCalled();
});
