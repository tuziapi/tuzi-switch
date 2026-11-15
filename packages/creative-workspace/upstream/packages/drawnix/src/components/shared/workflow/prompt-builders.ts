import type {
  VideoAnalysisData,
  VideoCharacter,
  VideoShot,
} from '../../../services/video-analysis-service';
import {
  formatCreativeBriefPromptBlock,
  type CreativeBrief,
} from './creative-brief';

interface WorkflowPromptProductInfo {
  prompt?: string;
  generationTopic?: string;
  videoStyle?: string;
  bgmMood?: string;
  creativeBrief?: CreativeBrief;
  generationContext?: string;
  generationAdvice?: string;
}

interface WorkflowFramePromptOptions {
  shot?: Pick<
    VideoShot,
    | 'id'
    | 'label'
    | 'startTime'
    | 'endTime'
    | 'description'
    | 'camera_movement'
    | 'transition_hint'
    | 'character_ids'
  >;
  characters?: VideoCharacter[];
  continueFromPreviousFrame?: boolean;
}

interface WorkflowVideoPromptOptions {
  referenceImageDescriptions?: string[];
}

interface WeightedPromptPart {
  text: string;
  contextWeight?: number;
}

export const MAX_VIDEO_GENERATION_PROMPT_LENGTH = 2500;
const PROMPT_SEPARATOR = '。';
const CONTEXT_WEIGHT = {
  creativeBrief: 15,
  generationContext: 20,
  bgmMood: 55,
  userRequirement: 72,
  videoStyle: 70,
  character: 98,
  referenceImage: 100,
  shotIdentity: 105,
  continuity: 90,
} as const;

function trimTrailingPeriod(text: string): string {
  return text.replace(/[。.]+$/, '');
}

function compactPromptText(text?: string, maxLength = 700): string {
  const compacted = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compacted) return '';
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength)}...`
    : compacted;
}

function buildGenerationContextBlock(
  analysis?: VideoAnalysisData,
  productInfo?: WorkflowPromptProductInfo | null
): string {
  const generationTopic = compactPromptText(productInfo?.generationTopic, 500);
  const extraContext = compactPromptText(productInfo?.generationContext, 900);
  const generationAdvice = compactPromptText(productInfo?.generationAdvice, 700);
  const aspectRatio = analysis?.aspect_ratio;

  const lines = [
    generationTopic ? `创作主题：${generationTopic}` : '',
    extraContext ? `背景信息：${extraContext}` : '',
    generationAdvice ? `生成建议：${generationAdvice}` : '',
    aspectRatio ? `画面比例：${aspectRatio}` : '',
  ].filter(Boolean);

  if (lines.length === 0) return '';

  return [
    '上下文内容：',
    ...lines,
    '上下文使用方式：这些内容用于稳定世界观、受众、音乐情绪、画面比例和生成禁忌；不要把上下文当成当前镜头的新增剧情。',
    '剧情/故事/案例/歌词等相似上下文只作低权重背景；若与当前镜头、当前关键帧、首尾帧或参考图说明不一致，不要复述、续写或覆盖它们。',
  ].join('\n');
}

function buildUserRequirementBlock(
  productInfo?: WorkflowPromptProductInfo | null
): string {
  const prompt = compactPromptText(productInfo?.prompt, 500);
  if (!prompt) return '';

  return [
    '用户要求：',
    prompt,
    '用户要求使用方式：用于校准主题、改编方向和取舍；高于故事上下文和创作 Brief；若与当前镜头、首尾帧或参考图说明冲突，优先执行当前镜头任务。',
  ].join('\n');
}

function buildFrameCharacterBlock(
  options?: WorkflowFramePromptOptions
): string {
  const ids = options?.shot?.character_ids || [];
  if (ids.length === 0 || !options?.characters?.length) return '';

  const characterLines = ids
    .map((id) => options.characters?.find((character) => character.id === id))
    .filter((character): character is VideoCharacter => !!character?.description)
    .map((character) => {
      const name = character.name || character.id;
      const referenceRule = character.referenceImageUrl
        ? '随请求附带角色参考图；以参考图为最高优先级锁定同一人物身份、脸型、五官、发型、肤色、体型、年龄感、服装款式、服装颜色、材质和配饰'
        : '严格按角色描述锁定同一人物身份、发型、肤色、体型、年龄感、服装款式、服装颜色、材质和配饰';
      return `${name}: ${character.description}（${referenceRule}）`;
    });

  return characterLines.length > 0
    ? [
        `画面内角色：${characterLines.join('; ')}`,
        '一致性优先级：角色参考图和角色描述高于当前关键帧文字；若关键帧文字与角色参考图冲突，保留参考图中的人物与服装，只调整姿态、表情、动作、镜头角度、光线和背景。',
        '禁止：换脸、换发型、换发色、改变年龄感、改变体型、重设计服装、替换衣服颜色或新增无关人物。',
      ].join('\n')
    : '';
}

function formatShotTimeRange(shot: WorkflowFramePromptOptions['shot']): string {
  if (!shot) return '';
  const hasStart = typeof shot.startTime === 'number';
  const hasEnd = typeof shot.endTime === 'number';
  if (!hasStart && !hasEnd) return '';
  return `${hasStart ? `${shot.startTime}s` : '?'}-${hasEnd ? `${shot.endTime}s` : '?'}`;
}

function buildFrameShotIdentityBlock(
  options?: WorkflowFramePromptOptions
): string {
  const shot = options?.shot;
  if (!shot) return '';

  const timeRange = formatShotTimeRange(shot);
  const label = compactPromptText(shot.label, 120);
  const description = compactPromptText(shot.description, 420);
  const cameraMovement = compactPromptText(shot.camera_movement, 180);
  const transitionHint = compactPromptText(shot.transition_hint, 80);

  const identityParts = [
    shot.id ? `ID ${shot.id}` : '',
    label,
    timeRange,
  ].filter(Boolean);

  const lines = [
    identityParts.length > 0 ? `镜头身份：${identityParts.join(' · ')}` : '',
    description ? `本镜头剧情/动作：${description}` : '',
    cameraMovement ? `本镜头运镜：${cameraMovement}` : '',
    transitionHint ? `转场方向：${transitionHint}` : '',
  ].filter(Boolean);

  if (lines.length === 0) return '';

  return [
    '片段区分锚点：',
    ...lines,
    '执行要求：优先表现本镜头独有的动作阶段、角色关系、主体位置、构图方向和情绪节奏；不要被全局上下文带偏成其它片段的相似画面。',
  ].join('\n');
}

function buildVideoReferenceImageBlock(
  options?: WorkflowVideoPromptOptions
): string {
  const descriptions = (options?.referenceImageDescriptions || [])
    .map((description) => compactPromptText(description, 260))
    .filter(Boolean);

  if (descriptions.length === 0) return '';

  return [
    '参考图说明：',
    ...descriptions.map((description, index) =>
      /^参考图\d+[：:]/.test(description)
        ? description
        : `参考图${index + 1}：${description}`
    ),
    '参考图使用方式：严格按每张图的用途使用；首帧/尾帧图用于时间起止，角色/全局参考图只用于主体、角色、产品、风格或场景一致性，不代表时间顺序。',
    '参考图优先级：每张图的用途高于故事上下文、相似剧情、歌词意象和创作 Brief；不要把全局参考图当成当前镜头剧情。',
  ].join('\n');
}

export function buildVideoReferenceImageDescriptions(
  images?: Array<{ name?: string; url?: string }>
): string[] | undefined {
  const descriptions = (images || [])
    .filter((image) => !!image.url?.trim())
    .map((image, index) => {
      const name = compactPromptText(image.name || '', 80);
      if (/首帧/.test(name)) {
        return `参考图${index + 1}：首帧图，只表示视频起始画面状态，视频必须从这张图开始，优先于故事上下文。`;
      }
      if (/尾帧/.test(name)) {
        return `参考图${index + 1}：尾帧图，只表示视频结束画面状态，视频应自然过渡到这张图，优先于故事上下文。`;
      }
      if (/角色/.test(name)) {
        return `参考图${index + 1}：角色参考图${name ? `（${name}）` : ''}，仅用于锁定人物身份、发型、服装、材质和气质，不表示时间顺序、动作或剧情。`;
      }
      return `参考图${index + 1}：${name || '用户提供的参考图'}，仅用于主体、产品、场景、风格或色彩一致性，不表示时间顺序、动作或剧情。`;
    });

  return descriptions.length > 0 ? descriptions : undefined;
}

function joinPromptParts(
  parts: WeightedPromptPart[],
  separator = PROMPT_SEPARATOR
): string {
  return parts
    .map((part) => part.text)
    .filter(Boolean)
    .join(separator);
}

function buildWeightedPrompt(
  parts: WeightedPromptPart[],
  maxLength = MAX_VIDEO_GENERATION_PROMPT_LENGTH,
  separator = PROMPT_SEPARATOR
): string {
  const activeParts = parts.filter((part) => part.text);
  let prompt = joinPromptParts(activeParts, separator);

  if (prompt.length <= maxLength) {
    return prompt;
  }

  const removedIndexes = new Set<number>();
  while (prompt.length > maxLength) {
    let dropIndex = -1;
    let dropWeight = Number.POSITIVE_INFINITY;
    let dropLength = -1;

    for (let index = 0; index < activeParts.length; index += 1) {
      if (removedIndexes.has(index)) continue;
      const part = activeParts[index];
      if (typeof part.contextWeight !== 'number') continue;

      if (
        part.contextWeight < dropWeight ||
        (part.contextWeight === dropWeight && part.text.length > dropLength)
      ) {
        dropIndex = index;
        dropWeight = part.contextWeight;
        dropLength = part.text.length;
      }
    }

    if (dropIndex < 0) {
      break;
    }

    removedIndexes.add(dropIndex);
    prompt = joinPromptParts(
      activeParts.filter((_, index) => !removedIndexes.has(index)),
      separator
    );
  }

  return prompt;
}

export function buildVideoPrompt(
  shot: VideoShot,
  analysis?: VideoAnalysisData,
  productInfo?: WorkflowPromptProductInfo | null,
  options?: WorkflowVideoPromptOptions
): string {
  const description = shot.description ? trimTrailingPeriod(shot.description) : '';
  const shotTimeRange = formatShotTimeRange(shot);
  const cameraMovement = shot.camera_movement
    ? trimTrailingPeriod(shot.camera_movement)
    : '';
  const firstFramePrompt = shot.first_frame_prompt
    ? trimTrailingPeriod(shot.first_frame_prompt)
    : '';
  const lastFramePrompt = shot.last_frame_prompt
    ? trimTrailingPeriod(shot.last_frame_prompt)
    : '';
  const transitionHint = shot.transition_hint
    ? trimTrailingPeriod(shot.transition_hint)
    : '';
  const narration = shot.narration ? trimTrailingPeriod(shot.narration) : '';
  const dialogue = shot.dialogue ? trimTrailingPeriod(shot.dialogue) : '';
  const dialogueSpeakers = shot.dialogue_speakers
    ? trimTrailingPeriod(shot.dialogue_speakers)
    : '';
  const speechRelation = shot.speech_relation
    ? trimTrailingPeriod(shot.speech_relation)
    : narration && dialogue
      ? 'both'
      : narration
        ? 'narration_only'
        : dialogue
          ? 'dialogue_only'
          : 'none';
  const narrationPrompt = narration ? `旁白：${narration}` : '';
  const dialoguePrompt = dialogue
    ? dialogueSpeakers
      ? `角色对白：由${dialogueSpeakers}发言。对白内容：${dialogue}`
      : `角色对白：${dialogue}`
    : '';

  const videoStyle = productInfo?.videoStyle || analysis?.video_style;
  const bgmMood = productInfo?.bgmMood || analysis?.bgm_mood;
  const generationContextBlock = buildGenerationContextBlock(
    analysis,
    productInfo
  );
  const userRequirementBlock = buildUserRequirementBlock(productInfo);
  const referenceImageBlock = buildVideoReferenceImageBlock(options);
  const creativeBriefBlock = formatCreativeBriefPromptBlock(
    productInfo?.creativeBrief,
    'generation'
  );

  const characterAnchor = shot.character_description
    ? `The same ${trimTrailingPeriod(shot.character_description)}`
    : '';

  const shotIdentity = [shot.id ? `ID ${shot.id}` : '', shot.label, shotTimeRange]
    .filter(Boolean)
    .join(' · ');

  return buildWeightedPrompt(
    [
    { text: '任务：请生成一个真实自然、上下文连贯的单镜头短视频。' },
    {
      text: [
        '优先级协议：当前镜头任务/首尾关键帧 > 参考图说明 > 角色一致性 > 用户要求 > 画面风格/BGM > 上下文内容/创作 Brief。',
        '故事情节、相似案例、歌词意象或全局剧情只作低权重背景；不得覆盖当前镜头、首尾帧或每张参考图的用途。',
      ].join('\n'),
    },
    {
      text: referenceImageBlock,
      contextWeight: CONTEXT_WEIGHT.referenceImage,
    },
    {
      text: characterAnchor ? `角色一致性：${characterAnchor}` : '',
      contextWeight: CONTEXT_WEIGHT.character,
    },
    {
      text: [
        '当前镜头任务：',
        shotIdentity ? `镜头身份：${shotIdentity}` : '',
        description ? `镜头主题：${description}` : '',
        '当前镜头使用方式：只生成这个镜头，不续写上下文剧情，不借用相邻镜头动作。',
      ].filter(Boolean).join('\n'),
    },
    { text: narrationPrompt },
    { text: dialoguePrompt },
    { text: `语音关系：${speechRelation}` },
    { text: firstFramePrompt ? `开场关键帧：${firstFramePrompt}` : '' },
    { text: lastFramePrompt ? `结束关键帧：${lastFramePrompt}` : '' },
    { text: cameraMovement ? `运镜方式：${cameraMovement}` : '' },
    { text: transitionHint ? `转场建议：${transitionHint}` : '' },
    {
      text: userRequirementBlock,
      contextWeight: CONTEXT_WEIGHT.userRequirement,
    },
    {
      text: videoStyle ? `画面风格：${trimTrailingPeriod(videoStyle)}` : '',
      contextWeight: CONTEXT_WEIGHT.videoStyle,
    },
    {
      text: bgmMood ? `BGM情绪：${trimTrailingPeriod(bgmMood)}` : '',
      contextWeight: CONTEXT_WEIGHT.bgmMood,
    },
    {
      text: generationContextBlock,
      contextWeight: CONTEXT_WEIGHT.generationContext,
    },
    {
      text: creativeBriefBlock,
      contextWeight: CONTEXT_WEIGHT.creativeBrief,
    },
    { text: '要求主体动作连贯、时序自然、画面风格统一，避免突兀跳变与闪烁' },
    ],
    MAX_VIDEO_GENERATION_PROMPT_LENGTH,
    '\n\n'
  );
}

export function buildFramePrompt(
  shotPrompt: string,
  analysis?: VideoAnalysisData,
  productInfo?: WorkflowPromptProductInfo | null,
  options?: WorkflowFramePromptOptions
): string {
  const videoStyle = productInfo?.videoStyle || analysis?.video_style;
  if (!shotPrompt) return shotPrompt;
  const bgmMood = productInfo?.bgmMood || analysis?.bgm_mood;
  const generationContextBlock = buildGenerationContextBlock(
    analysis,
    productInfo
  );
  const creativeBriefBlock = formatCreativeBriefPromptBlock(
    productInfo?.creativeBrief,
    'generation'
  );
  const characterBlock = buildFrameCharacterBlock(options);
  const shotIdentityBlock = buildFrameShotIdentityBlock(options);
  return buildWeightedPrompt([
    {
      text: `当前关键帧（最高优先级）：${shotPrompt}。必须严格生成这一帧，不要生成相邻片段、角色参考图姿势或全局剧情的泛化画面`,
    },
    {
      text: '关键帧优先级：当前关键帧优先于故事/剧情上下文、相似案例、歌词意象、创作 Brief 和全局参考内容；上下文只用于风格、画幅、受众和禁忌。',
    },
    {
      text: shotIdentityBlock,
      contextWeight: CONTEXT_WEIGHT.shotIdentity,
    },
    {
      text: characterBlock,
      contextWeight: CONTEXT_WEIGHT.character,
    },
    {
      text: options?.continueFromPreviousFrame
        ? '连续性要求：当前首帧必须自然承接上一镜头尾帧参考图，保持主体位置、光线方向、色彩和动作趋势连贯；不要复述上一镜头剧情经过。'
        : '',
      contextWeight: CONTEXT_WEIGHT.continuity,
    },
    {
      text: videoStyle ? trimTrailingPeriod(videoStyle) : '',
      contextWeight: CONTEXT_WEIGHT.videoStyle,
    },
    {
      text: bgmMood ? `BGM情绪：${trimTrailingPeriod(bgmMood)}` : '',
      contextWeight: CONTEXT_WEIGHT.bgmMood,
    },
    {
      text: generationContextBlock,
      contextWeight: CONTEXT_WEIGHT.generationContext,
    },
    {
      text: creativeBriefBlock,
      contextWeight: CONTEXT_WEIGHT.creativeBrief,
    },
  ]);
}

export function buildCharacterReferencePrompt(
  character: VideoCharacter,
  analysis?: VideoAnalysisData,
  productInfo?: WorkflowPromptProductInfo | null
): string {
  const videoStyle = productInfo?.videoStyle || analysis?.video_style;
  const bgmMood = productInfo?.bgmMood || analysis?.bgm_mood;
  const generationContextBlock = buildGenerationContextBlock(
    analysis,
    productInfo
  );
  const creativeBriefBlock = formatCreativeBriefPromptBlock(
    productInfo?.creativeBrief,
    'generation'
  );

  return buildWeightedPrompt(
    [
      {
        text: '请生成一个可复用的角色参考图，单个主体，1:1 构图，完整清晰展示角色外貌、发型、服装、气质和材质细节。',
      },
      { text: `角色名称：${character.name || character.id}` },
      { text: `角色外貌：${character.description}` },
      {
        text: '角色参考图优先级：故事/MV剧情/歌词意象仅用于微调情绪与风格，不决定姿势、动作、场景或剧情。',
      },
      {
        text: videoStyle ? `画面风格：${trimTrailingPeriod(videoStyle)}` : '',
        contextWeight: CONTEXT_WEIGHT.videoStyle,
      },
      {
        text: bgmMood ? `BGM情绪：${trimTrailingPeriod(bgmMood)}` : '',
        contextWeight: CONTEXT_WEIGHT.bgmMood,
      },
      {
        text: generationContextBlock,
        contextWeight: CONTEXT_WEIGHT.generationContext,
      },
      {
        text: creativeBriefBlock,
        contextWeight: CONTEXT_WEIGHT.creativeBrief,
      },
      {
        text: '要求：只生成稳定的角色设定图，用中性站姿或半身展示锁定外貌、发型、服装和材质；不要演绎具体镜头动作、剧情拥抱、奔跑、跳舞或片段构图；不要生成多人、文字、Logo、水印或无关背景。',
      },
    ],
    MAX_VIDEO_GENERATION_PROMPT_LENGTH,
    '\n'
  );
}
