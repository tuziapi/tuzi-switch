import { getConfiguredSelectableModels } from '../../utils/runtime-model-discovery';
import { findMatchingSelectableModel, getModelRefFromConfig } from '../../utils/model-selection';
import { workspaceService } from '../workspace-service';
import { textChatRuntime } from './runtime';
import { createModelRef, resolveInvocationRoute, settingsManager, type ModelRef } from '../../utils/settings-manager';

/** Prefer a configured text model when the global default is absent from the user's catalog. */
export function discussionDefaultModel(): ModelRef | null {
  const route = resolveInvocationRoute('text');
  const models = getConfiguredSelectableModels('text');
  const model = findMatchingSelectableModel(models, route.modelId, createModelRef(route.profileId, route.modelId)) || models[0];
  return getModelRefFromConfig(model) || (model ? createModelRef(model.sourceProfileId || null, model.id) : createModelRef(route.profileId, route.modelId));
}

export async function openDiscussion(boardId: string | null, model?: ModelRef | null) {
  if (!boardId) throw new Error('请先打开画板。');
  await settingsManager.waitForInitialization();
  const id = await textChatRuntime.ensureDiscussion(boardId, model || discussionDefaultModel());
  if (workspaceService.getState().currentBoardId !== boardId) return id;
  textChatRuntime.select(id);
  window.dispatchEvent(new CustomEvent('aitu:open-discussion', { detail: { boardId } }));
  return id;
}
