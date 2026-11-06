import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceService } from '../workspace-service';
import type { Board, BoardChangeData, Folder } from '../../types/workspace.types';

const storage = vi.hoisted(() => ({ loadBoard: vi.fn(), saveBoard: vi.fn(), isWriteSuspended: vi.fn(() => false), saveFolder: vi.fn(), deleteFolder: vi.fn() }));
vi.mock('../workspace-storage-service', () => ({ workspaceStorageService: storage }));
vi.mock('../github-sync/sync-log-service', () => ({ logDebug: vi.fn(), logWarning: vi.fn(), logError: vi.fn() }));

const runtime = workspaceService as unknown as {
    initialized: boolean; folders: Map<string, Folder>; loadedBoards: Map<string, Board>; boards: Map<string, Board>;
    boardMetadata: Map<string, Omit<Board, 'elements'>>; unsavedBoards: Map<string, object>;
    state: { currentBoardId: string | null };
};
const board = (id: string) => ({ id, name: id, folderId: null, order: 0, viewport: { zoom: 0.5 }, elements: [{ id: `element-${id}` }], updatedAt: 1 } as unknown as Board);
beforeEach(() => {
    vi.clearAllMocks();
    storage.loadBoard.mockReset(); storage.saveBoard.mockReset();
    runtime.initialized = true; runtime.folders.clear();
    runtime.loadedBoards.clear(); runtime.boards.clear(); runtime.boardMetadata.clear(); runtime.unsavedBoards.clear();
    runtime.state.currentBoardId = 'current';
    for (const id of ['current', 'a', 'b', 'c', 'd']) {
        const item = board(id);
        const { elements, ...metadata } = item;
        runtime.boardMetadata.set(id, metadata);
        runtime.boards.set(id, { ...metadata, elements: [] });
    }
    storage.loadBoard.mockImplementation(async id => board(id));
    storage.saveBoard.mockResolvedValue(undefined);
});

describe('workspace full-board retention', () => {
    it('a stale guarded reload cannot replace a new insertion or clear its pending save', async () => {
        let accept = true;
        let resolveRead!: (value: Board) => void;
        let resolveSave!: () => void;
        storage.loadBoard.mockReturnValueOnce(new Promise<Board>(resolve => { resolveRead = resolve; }));
        storage.saveBoard.mockReturnValueOnce(new Promise<void>(resolve => { resolveSave = resolve; }));
        const events = vi.fn();
        const subscription = workspaceService.observeEvents().subscribe(events);
        const reload = workspaceService.reloadBoard('current', () => accept);
        await Promise.resolve();
        const data = { children: [{ id: 'new-image' }], viewport: {}, theme: {} } as unknown as BoardChangeData;
        const saving = workspaceService.saveBoard('current', data);
        accept = false;
        resolveRead(board('current'));
        expect(await reload).toBeNull();
        expect(workspaceService.getCurrentBoard()?.elements).toEqual(data.children);
        expect(runtime.unsavedBoards.has('current')).toBe(true);
        expect(events).not.toHaveBeenCalled();
        subscription.unsubscribe();
        resolveSave();
        await saving;
    });

    it('does not start a storage read for an already obsolete guarded request', async () => {
        expect(await workspaceService.reloadBoard('current', () => false)).toBeNull();
        expect(storage.loadBoard).not.toHaveBeenCalled();
    });

    it('still applies current guarded reloads and emits the existing refresh events', async () => {
        const events = vi.fn();
        const subscription = workspaceService.observeEvents().subscribe(events);
        expect((await workspaceService.reloadBoard('current', () => true))?.elements).toHaveLength(1);
        expect(events.mock.calls.map(([event]) => event.type)).toEqual(['boardUpdated', 'boardSwitched']);
        subscription.unsubscribe();
    });

    it('discards a guarded read if the user switches boards while it is pending', async () => {
        let resolveRead!: (value: Board) => void;
        storage.loadBoard.mockReturnValueOnce(new Promise<Board>(resolve => { resolveRead = resolve; }));
        const reload = workspaceService.reloadBoard('current', () => runtime.state.currentBoardId === 'current');
        await Promise.resolve();
        runtime.state.currentBoardId = 'a';
        resolveRead(board('current'));
        expect(await reload).toBeNull();
        expect(runtime.loadedBoards.has('current')).toBe(false);
    });

    it('reloads and empty checks share a bounded cache while retaining the current board', async () => {
        await workspaceService.reloadBoard('current');
        await workspaceService.reloadBoard('a');
        await workspaceService.reloadBoard('b');
        expect(await workspaceService.isBoardEmptyAsync('c')).toBe(false);
        await workspaceService.reloadBoard('d');
        expect(runtime.loadedBoards.size).toBe(3);
        expect(workspaceService.getBoard('current')?.elements).toHaveLength(1);
        expect(workspaceService.getBoard('a')?.elements).toEqual([]);
        expect(storage.loadBoard).toHaveBeenCalledWith('c');
    });

    it('a failed save retains unsaved content across subsequent cache pressure and a retry', async () => {
        await workspaceService.reloadBoard('a');
        storage.saveBoard.mockRejectedValueOnce(new Error('quota'));
        const data = { children: [{ id: 'unsaved' }], viewport: {}, theme: {} } as unknown as BoardChangeData;
        await expect(workspaceService.saveBoard('a', data)).rejects.toThrow('quota');
        for (const id of ['current', 'b', 'c', 'd']) await workspaceService.reloadBoard(id);
        expect(workspaceService.getBoard('a')?.elements).toEqual(data.children);
        await workspaceService.saveBoard('a', data);
        expect(runtime.unsavedBoards.has('a')).toBe(false);
        expect(runtime.loadedBoards.size).toBeLessThanOrEqual(3);
    });

    it('a successful explicit reload releases the discarded dirty board exemption', async () => {
        await workspaceService.reloadBoard('a');
        storage.saveBoard.mockRejectedValueOnce(new Error('quota'));
        await expect(workspaceService.saveBoard('a', { children: [{ id: 'unsaved' }] } as unknown as BoardChangeData)).rejects.toThrow('quota');
        storage.loadBoard.mockRejectedValueOnce(new Error('read failed'));
        await expect(workspaceService.reloadBoard('a')).rejects.toThrow('read failed');
        expect(runtime.unsavedBoards.has('a')).toBe(true);
        await workspaceService.reloadBoard('a');
        expect(runtime.unsavedBoards.has('a')).toBe(false);
        for (const id of ['current', 'b', 'c', 'd']) await workspaceService.reloadBoard(id);
        expect(runtime.loadedBoards.size).toBeLessThanOrEqual(3);
    });
});


describe('update persistence barrier', () => {
    it('flushes a failed write with original elements before allowing update', async () => {
        await workspaceService.reloadBoard('a');
        storage.saveBoard.mockRejectedValueOnce(new Error('quota'));
        const data = { children: [{ id: 'new-image' }], viewport: {}, theme: {} } as unknown as BoardChangeData;
        await expect(workspaceService.saveBoard('a', data)).rejects.toThrow('quota');
        await workspaceService.flushForAppUpdate();
        expect(runtime.unsavedBoards.size).toBe(0);
        expect(storage.saveBoard.mock.lastCall?.[0].elements).toEqual(data.children);
    });
    it('does not report success on storage failure or migration', async () => {
        await workspaceService.reloadBoard('a');
        runtime.unsavedBoards.set('a', {});
        storage.saveBoard.mockRejectedValueOnce(new Error('quota'));
        await expect(workspaceService.flushForAppUpdate()).rejects.toThrow('quota');
        expect(runtime.unsavedBoards.has('a')).toBe(true);
        storage.isWriteSuspended.mockReturnValueOnce(true);
        await expect(workspaceService.flushForAppUpdate()).rejects.toThrow('迁移');
    });
});


describe('metadata operations on unopened or evicted boards', () => {
    it('renaming from the project list preserves stored elements and viewport', async () => {
        await workspaceService.renameBoard('a', 'Renamed');
        expect(storage.saveBoard).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Renamed', elements: board('a').elements, viewport: board('a').viewport,
        }));
        expect(runtime.loadedBoards.size).toBe(0);
    });

    it('reordering and moving preserves every unopened sibling', async () => {
        await workspaceService.reorderItems([{ id: 'a', type: 'board', order: 3 }]);
        await workspaceService.moveBoard('b', null, 'a', 'after');
        for (const [saved] of storage.saveBoard.mock.calls) {
            expect(saved.elements).toEqual(board(saved.id).elements);
        }
        expect(storage.saveBoard.mock.calls.length).toBeGreaterThan(1);
    });

    it('moving folders and removing a folder preserve its unopened boards', async () => {
        runtime.folders.set('folder', { id: 'folder', name: 'Folder', parentId: null, order: 0 } as Folder);
        await workspaceService.moveFolder('folder', null);
        runtime.boards.get('a')!.folderId = 'folder';
        runtime.boardMetadata.get('a')!.folderId = 'folder';
        await workspaceService.deleteFolder('folder');
        expect(storage.saveBoard.mock.lastCall?.[0]).toMatchObject({
            id: 'a', folderId: null, elements: board('a').elements,
        });
        for (const [saved] of storage.saveBoard.mock.calls) expect(saved.elements).toHaveLength(1);
    });

    it('copying an unopened board copies its original content', async () => {
        const copy = await workspaceService.copyBoard('a');
        expect(copy.elements).toEqual(board('a').elements);
        expect(copy.viewport).toEqual(board('a').viewport);
        expect(copy.id).not.toBe('a');
    });

    it('does not persist a placeholder when the stored board cannot be read', async () => {
        storage.loadBoard.mockResolvedValueOnce(null);
        await expect(workspaceService.renameBoard('a', 'Renamed')).rejects.toThrow();
        expect(storage.saveBoard).not.toHaveBeenCalled();
    });

    it('uses current unsaved content instead of an older stored copy', async () => {
        await workspaceService.reloadBoard('a');
        runtime.loadedBoards.get('a')!.elements = [{ id: 'new-unsaved' }] as Board['elements'];
        storage.loadBoard.mockClear();
        await workspaceService.renameBoard('a', 'Renamed');
        expect(storage.loadBoard).not.toHaveBeenCalled();
        expect(storage.saveBoard.mock.lastCall?.[0].elements).toEqual([{ id: 'new-unsaved' }]);
    });
});
