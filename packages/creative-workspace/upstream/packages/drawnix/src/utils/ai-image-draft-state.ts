export interface AIImageDraftState {
  prompt: string;
  imageCount: number;
  knowledgeContextCount: number;
}

let currentDraft: AIImageDraftState = {
  prompt: '',
  imageCount: 0,
  knowledgeContextCount: 0,
};

export function setAIImageDraftState(draft: AIImageDraftState): void {
  currentDraft = {
    prompt: draft.prompt,
    imageCount: draft.imageCount,
    knowledgeContextCount: draft.knowledgeContextCount,
  };
}

export function clearAIImageDraftState(): void {
  currentDraft = {
    prompt: '',
    imageCount: 0,
    knowledgeContextCount: 0,
  };
}

export function hasAIImageDraftContent(): boolean {
  return (
    currentDraft.prompt.trim().length > 0 ||
    currentDraft.imageCount > 0 ||
    currentDraft.knowledgeContextCount > 0
  );
}
