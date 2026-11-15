import {
  AssetCategory,
  AssetSource,
  type Asset,
} from '../types/asset.types';
import { assetStorageService } from './asset-storage-service';
import { taskStorageWriter } from './media-executor/task-storage-writer';
import { unifiedCacheService } from './unified-cache-service';

export interface CharacterAssetMark {
  name: string;
  prompt?: string;
}

function buildCharacterMetadata(mark: CharacterAssetMark) {
  return {
    category: AssetCategory.CHARACTER,
    characterName: mark.name,
    characterPrompt: mark.prompt?.trim() || undefined,
  };
}

export async function markAssetAsCharacter(
  asset: Asset,
  mark: CharacterAssetMark
): Promise<void> {
  const metadata = buildCharacterMetadata(mark);
  const characterMeta = {
    name: mark.name,
    ...(mark.prompt?.trim() && { prompt: mark.prompt.trim() }),
  };

  await unifiedCacheService.updateCachedMedia(asset.url, {
    metadata,
  });

  if (asset.id.startsWith('unified-cache-')) {
    return;
  }

  if (asset.source === AssetSource.AI_GENERATED) {
    const taskId = asset.taskId || asset.id;
    const task = await taskStorageWriter.getTask(taskId);
    if (task) {
      task.params = {
        ...task.params,
        assetMetadata: metadata,
      };
      await taskStorageWriter.saveTask(task);
    }
    return;
  }

  await assetStorageService.updateAssetMetadata(asset.id, {
    category: AssetCategory.CHARACTER,
    characterMeta,
  });
}
