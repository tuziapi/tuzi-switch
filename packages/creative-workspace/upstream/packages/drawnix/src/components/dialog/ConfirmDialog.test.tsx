import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

let host: HTMLDivElement | undefined;
afterEach(() => {
  host?.remove();
  host = undefined;
});
function fixture() {
  host = document.createElement('div');
  host.className = 'creative-root';
  host.innerHTML = '<div id="creative-portals"></div>';
  document.body.append(host);
}
function Task({ remove }: { remove: () => void }) {
  const [open, setOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  return (
    <>
      {!deleted && <button onClick={() => setOpen(true)}>删除合成任务</button>}
      <ConfirmDialog
        open={open}
        title="确认删除"
        onOpenChange={setOpen}
        onConfirm={() => {
          remove();
          setDeleted(true);
        }}
        confirmText="删除"
      />
    </>
  );
}

describe('creative confirmation portal', () => {
  it('stays inside the creative scope, cancels without deleting, then confirms once', async () => {
    fixture();
    const remove = vi.fn();
    render(<Task remove={remove} />);
    fireEvent.click(screen.getByRole('button', { name: '删除合成任务' }));
    const dialog = await screen.findByRole('dialog', { name: '确认删除' });
    expect(dialog.closest('#creative-portals')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(remove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '删除合成任务' }));
    fireEvent.click(
      await screen.findByRole('button', { name: '删除', exact: true }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '删除合成任务' })).toBeNull();
  });

  it('preserves an explicit container', async () => {
    fixture();
    const explicit = document.createElement('div');
    host!.append(explicit);
    render(<ConfirmDialog open title="指定容器" container={explicit} />);
    expect(explicit.contains(await screen.findByRole('dialog'))).toBe(true);
  });

  it('still works standalone without an assistant portal', async () => {
    render(<ConfirmDialog open title="独立画布" />);
    expect(document.body.contains(await screen.findByRole('dialog'))).toBe(
      true,
    );
  });
});
