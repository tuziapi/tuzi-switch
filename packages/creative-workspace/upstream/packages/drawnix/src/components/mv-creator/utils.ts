/**
 * 爆款MV生成器 - 工具函数
 */
import { generateUUID } from '../../utils/runtime-helpers';

import type { MVRecord, StoryboardVersion, VideoShot, VideoCharacter } from './types';
import { computeSegmentPlan } from '../../utils/segment-plan';
import { getVideoModelConfig } from '../../constants/video-model-config';
import {
  DEFAULT_ORIGINAL_VERSION_ID,
  appendVersionToRecord,
  formatCreativeBriefPromptBlock,
  formatCreativeBriefSummary,
  switchVersionInRecord,
  updateActiveVersionShotsInRecord,
} from '../shared/workflow';

// ── 分镜版本管理 ──

const MAX_STORYBOARD_VERSIONS = 10;
const ORIGINAL_CONTENT_GUARDRAIL =
  '原创性与合规要求：若音乐、歌词、创作 Brief 或用户提示词包含知名影视、动画、游戏、音乐、品牌、角色、商标、Logo、台词、歌词或受保护作品名称，不要复刻或仿写，不要使用原名称、标志性造型、独特服装、台词、歌词、镜头或世界观；请改写为原创的泛化角色、场景、音乐情绪和视觉元素，并保持商业可用。';

export function createStoryboardVersion(
  shots: VideoShot[],
  label: string,
  prompt?: string,
  snapshot?: {
    characters?: VideoCharacter[];
    videoStyle?: string;
  }
): StoryboardVersion {
  return {
    id: generateUUID(),
    createdAt: Date.now(),
    label,
    prompt,
    shots: structuredClone(shots),
    ...(snapshot?.characters ? { characters: structuredClone(snapshot.characters) } : {}),
    ...(snapshot?.videoStyle ? { videoStyle: snapshot.videoStyle } : {}),
  };
}

export function addStoryboardVersionToRecord(
  record: MVRecord,
  version: StoryboardVersion
): Partial<MVRecord> {
  return appendVersionToRecord(record, 'storyboardVersions', version, MAX_STORYBOARD_VERSIONS, {
    editedShots: version.shots,
  });
}

export const ORIGINAL_VERSION_ID = DEFAULT_ORIGINAL_VERSION_ID;

export function switchToVersion(
  record: MVRecord,
  versionId: string
): Partial<MVRecord> | null {
  return switchVersionInRecord(record, 'storyboardVersions', versionId, {
    getVersionPatch: (version) => ({
      editedShots: version.shots,
      ...(version.characters ? { characters: structuredClone(version.characters) } : {}),
      ...(version.videoStyle ? { videoStyle: version.videoStyle } : {}),
    }),
    getOriginalPatch: (currentRecord) => {
      const firstVersion = currentRecord.storyboardVersions?.[currentRecord.storyboardVersions.length - 1];
      return firstVersion ? { editedShots: [...firstVersion.shots] } : null;
    },
    originalVersionId: ORIGINAL_VERSION_ID,
  });
}

export function updateActiveShotsInRecord(
  record: MVRecord,
  updatedShots: VideoShot[]
): Partial<MVRecord> {
  return updateActiveVersionShotsInRecord(record, 'storyboardVersions', updatedShots);
}

export function formatMVShotsMarkdown(
  record: MVRecord,
  shots: VideoShot[] = record.editedShots || []
): string {
  const totalDuration = record.selectedClipDuration
    || shots.reduce((max, shot) => Math.max(max, shot.endTime || 0), 0);
  const musicStyles = record.musicStyleTags?.filter(Boolean).join(', ');
  const characters = record.characters || [];
  const creativeBrief = formatCreativeBriefSummary(record.creativeBrief);
  const headerLines = [
    '# 爆款MV脚本',
    '',
    `**音乐标题：** ${record.musicTitle || '-'}`,
    `**音乐风格：** ${musicStyles || '-'}`,
    `**时长：** ${totalDuration || 0}s`,
    `**画面比例：** ${record.aspectRatio || '16x9'}`,
    `**视频风格：** ${record.videoStyle || '-'}`,
  ];

  if (creativeBrief) {
    headerLines.push('', '## 创作 Brief', '', creativeBrief);
  }

  if (record.musicLyrics?.trim()) {
    headerLines.push('', '## 歌词', '', record.musicLyrics.trim());
  }

  if (record.rewritePrompt?.trim()) {
    headerLines.push('', '## 改编提示词', '', record.rewritePrompt.trim());
  }

  if (characters.length > 0) {
    headerLines.push('', '## 角色设定', '');
    characters.forEach((character, index) => {
      headerLines.push(`### ${index + 1}. ${character.name || character.id}`);
      headerLines.push(`- ID：${character.id}`);
      headerLines.push(`- 外观提示词：${character.description || '-'}`);
      if (character.referenceImageUrl) {
        headerLines.push(`- 参考图：${character.referenceImageUrl}`);
      }
      headerLines.push('');
    });
  }

  const shotSections = shots.map((shot, index) => {
    const lines = [
      `### ${index + 1}. ${shot.label || `镜头 ${index + 1}`} (${shot.startTime}s-${shot.endTime}s)`,
      '',
      `**画面描述：** ${shot.description || '-'}`,
      '',
      `**旁白：** ${shot.narration || '-'}`,
      shot.dialogue ? `\n**角色对白：** ${shot.dialogue}` : '',
      shot.dialogue_speakers ? `\n**对白角色：** ${shot.dialogue_speakers}` : '',
      shot.speech_relation ? `\n**语音关系：** ${shot.speech_relation}` : '',
      shot.camera_movement ? `\n**运镜：** ${shot.camera_movement}` : '',
      shot.first_frame_prompt ? `\n**首帧 Prompt：** ${shot.first_frame_prompt}` : '',
      shot.last_frame_prompt ? `\n**尾帧 Prompt：** ${shot.last_frame_prompt}` : '',
      shot.transition_hint ? `\n**转场：** ${shot.transition_hint}` : '',
      shot.character_ids?.length ? `\n**角色：** ${shot.character_ids.join(', ')}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  });

  return `${headerLines.join('\n')}\n\n## 分镜\n\n${shotSections.join('\n\n---\n\n')}`;
}

// ── AI 分镜 Prompt ──

export function buildStoryboardPrompt(params: {
  musicTitle?: string;
  musicStyleTags?: string[];
  musicLyrics?: string;
  clipDuration: number;
  videoModel: string;
  segmentDuration?: number;
  aspectRatio?: string;
  videoStyle?: string;
  creativeBrief?: MVRecord['creativeBrief'];
  hasAudio?: boolean;
}): string {
  const {
    musicTitle,
    musicStyleTags,
    musicLyrics,
    clipDuration,
    videoModel,
    segmentDuration,
    aspectRatio,
    videoStyle,
    creativeBrief,
    hasAudio,
  } = params;

  const cfg = getVideoModelConfig(videoModel);
  const selectedDuration = segmentDuration || parseInt(cfg.defaultDuration, 10) || 8;
  const singleOption = [{ label: `${selectedDuration}秒`, value: String(selectedDuration) }];
  const plan = computeSegmentPlan(clipDuration, singleOption);
  const { segments, actualTotal, isFixed, overflow } = plan;
  const segmentCount = segments.length;

  const durationInfo = isFixed
    ? `视频模型（${videoModel}）为固定时长模型，每段固定 ${segments[0]} 秒。实际总时长：${actualTotal} 秒（${segmentCount} 段）${overflow > 0 ? `，比音乐时长 ${clipDuration} 秒多出 ${overflow} 秒` : ''}。`
    : `分段方案：${segments.map((d, i) => `第${i + 1}段 ${d}s`).join('、')}，实际总时长 ${actualTotal} 秒。`;

  const musicInfo = [
    musicTitle ? `- 标题：${musicTitle}` : '',
    musicStyleTags?.length ? `- 风格标签：${musicStyleTags.join(', ')}` : '',
    `- 时长：${clipDuration}秒`,
    musicLyrics ? `- 歌词：\n${musicLyrics}` : '',
  ].filter(Boolean).join('\n');

  const audioInstruction = hasAudio
    ? `
⚠️ 重要：本次请求附带了音频文件。你必须先完整听完这段音乐，基于你听到的实际节奏、节拍、情绪变化来编排分镜，而不是仅凭歌词文本猜测。

第一步：音频分析（必须基于你听到的音乐）
- 听完整段音乐，标记关键时间节点：前奏结束时间、主歌开始/结束、副歌开始/结束、间奏、尾奏等
- 识别节拍变化：哪里节奏加快、哪里放缓、哪里有停顿或重音
- 识别情绪曲线：铺垫→推进→高潮→回落的精确时间点
- 如果有歌词，标注每句歌词对应的实际演唱时间`
    : `
第一步：歌词结构分析
- 将歌词按段落划分（Intro/Verse/Pre-Chorus/Chorus/Bridge/Outro 等）
- 估算每个段落在 ${clipDuration} 秒音乐中的大致时间位置
- 识别情绪曲线：哪里是铺垫、哪里是高潮、哪里是收尾`;

  return `你是一个专业的 MV 分镜导演。请根据音乐和创作 Brief，规划一组视频分镜脚本。

音乐信息：
${musicInfo}

${ORIGINAL_CONTENT_GUARDRAIL}

视频生成约束：
- 视频模型：${videoModel}
- ${durationInfo}
- 需要 ${segmentCount} 个视频片段
- 画面比例：${aspectRatio || '16x9'}
${videoStyle ? `- 画面风格：${videoStyle}` : ''}

${formatCreativeBriefPromptBlock(creativeBrief, 'mv')}

角色提取要求（极其重要！）：
1. 分析音乐信息和创作 Brief 中涉及的角色（人物、动物等有外貌特征的主体），无角色则 characters 为空数组
2. 为每个角色生成：id（"char_1", "char_2"...）、name（展示名）、description（英文外貌描述，包含发型、服装、体型、肤色等，可直接用于文生图）
3. 每个镜头标注 character_ids（该镜头涉及的角色 ID 列表，无角色则为空数组）
4. first_frame_prompt 中若有角色，必须包含对应角色的完整外貌描述，并明确沿用同一人物身份、脸型五官、发型、体型、年龄感、完整服装款式、服装颜色、材质和配饰，不得重新设计衣服；同时每个镜头必须写入本镜头独有的视觉锚点（动作阶段、主体位置、角色关系、道具状态、镜头角度或情绪节奏），避免不同片段只复用相同场景/角色/风格描述；last_frame_prompt 可为空，只有确实需要独立尾帧图时才填写，非空时必须保持同一人物、同一发型、同一套衣服和同一配饰
5. 创作 Brief、歌词意象、相似案例和相似剧情只作背景，不要覆盖首帧/尾帧、角色设定和每段音乐时间点的画面任务；不要把相似剧情复述进 first_frame_prompt 或 last_frame_prompt。

分镜规划步骤（请严格按顺序执行）：
${audioInstruction}

第二步：时间轴对齐
- 将 ${segmentCount} 个视频片段（${segments.map((d, i) => `第${i + 1}段=${d}s`).join('、')}）映射到音乐时间轴上
- 每个镜头的切换点必须对齐音乐的节奏变化点（段落切换、节拍重音、情绪转折）
- 不允许镜头内容与音乐时间错位（例如：副歌在 30s 开始，对应镜头不能放在 10s）

第三步：逐镜头编排
- 每个镜头的 description 必须体现该时间段音乐的情感和节奏
- 前奏/无歌词段：氛围铺垫（环境、光影、空镜），节奏跟随音乐律动
- 主歌段：叙事性画面，运镜节奏匹配音乐节拍
- 副歌段：情绪爆发，运镜更强烈，色彩更饱满，剪辑节奏加快
- 间奏段：转折或留白，可用特写或抽象画面
- 尾奏段：情绪回落，运镜放缓，呼应开场

分镜格式要求：
1. 每个镜头的 duration 必须等于对应段的时长：${segments.map((d, i) => `第${i + 1}段=${d}s`).join('、')}
2. startTime 从 0 开始，每个镜头的 startTime = 上一个镜头的 endTime
3. 镜头之间要有视觉连贯性（共同视觉元素、运镜方向延续、色调一致）
4. 所有字段使用与音乐信息或创作 Brief 一致的语言
5. 视频模型单段通常只有 8-15 秒；连续超过单段时长的内容必须拆成多个连续镜头。连续拆分时，第 N+1 段的 first_frame_prompt 只描述当前段起始画面，可包含第 N 段结尾的短视觉锚点（主体位置、动作瞬间、光线方向），不要写上一段剧情经过；第 N 段 last_frame_prompt 留空字符串；只有最后一段、非连续转场、明确需要独立结束定格时才填写 last_frame_prompt

每个镜头输出字段：
- id: 镜头ID（如 "shot_1"）
- startTime: 开始时间（秒）
- endTime: 结束时间（秒）
- duration: 时长（秒）
- label: 镜头标签（如"前奏 0:00-0:08"、"主歌A 0:08-0:16"），标注时间范围和对应歌词片段
- type: 镜头类型（opening/scene/detail/cta/other）
- description: 画面描述（详细描述场景、人物、动作、光线、色调，必须与该时间段的音乐节奏和歌词内容呼应）
- narration: 旁白（MV 通常为空字符串）
- camera_movement: 运镜方式（必须匹配该段音乐的节奏感）
- first_frame_prompt: 首帧图片提示词（精确描述主体位置、动作起始状态、构图、光线与背景；必须写入本镜头独有的视觉锚点、差异化动作起点、构图角度和角色关系，避免只复用同一角色外貌、同一场景和同一泛化风格；若该镜头有角色，必须包含对应角色的完整外貌、发型、脸部特征、体型、年龄感、服装款式、服装颜色、材质和配饰）
- last_frame_prompt: 尾帧图片提示词，可为空字符串（只有需要独立尾帧图时才填写；若下一段首帧自然承接为本段尾帧，则填 ""；非空时必须沿用同一人物和同一套服装，只改变本镜头结尾姿态、表情、动作定格、构图、光线或背景，不写下一镜头剧情）
- transition_hint: 转场方式（cut/dissolve/match_cut/fade_to_black）
- character_ids: 该镜头涉及的角色 ID 列表（无角色则为空数组 []）

返回 JSON 对象（不要 markdown 格式），格式如下：
{
  "characters": [
    { "id": "char_1", "name": "角色名", "description": "English appearance description for text-to-image" }
  ],
  "shots": [ ...镜头数组... ]
}`;
}

// ── AI 脚本改编 Prompt ──

export function buildMVScriptRewritePrompt(params: {
  record: MVRecord;
  currentShots: VideoShot[];
  rewritePrompt: string;
  videoModel: string;
  segmentDuration?: number;
  videoStyle?: string;
}): string {
  const { record, currentShots, rewritePrompt, videoModel, segmentDuration, videoStyle } = params;
  const clipDuration = record.selectedClipDuration || 30;
  const characters = record.characters || [];
  const hasCharacters = characters.length > 0;

  const cfg = getVideoModelConfig(videoModel);
  const selectedDuration = segmentDuration || parseInt(cfg.defaultDuration, 10) || 8;
  const singleOption = [{ label: `${selectedDuration}秒`, value: String(selectedDuration) }];
  const plan = computeSegmentPlan(clipDuration, singleOption);
  const { segments, actualTotal, isFixed, overflow } = plan;
  const segmentCount = segments.length;

  const durationInfo = isFixed
    ? `视频模型（${videoModel}）为固定时长模型，每段固定 ${segments[0]} 秒。实际总时长：${actualTotal} 秒（${segmentCount} 段）${overflow > 0 ? `，比音乐时长 ${clipDuration} 秒多出 ${overflow} 秒` : ''}。`
    : `分段方案：${segments.map((d, i) => `第${i + 1}段 ${d}s`).join('、')}，实际总时长 ${actualTotal} 秒。`;

  const musicInfo = [
    record.musicTitle ? `- 标题：${record.musicTitle}` : '',
    record.musicStyleTags?.length ? `- 风格标签：${record.musicStyleTags.join(', ')}` : '',
    `- 时长：${clipDuration}秒`,
    record.musicLyrics ? `- 歌词：\n${record.musicLyrics}` : '',
  ].filter(Boolean).join('\n');

  const shotsJson = JSON.stringify(currentShots.map(s => ({
    id: s.id, label: s.label, type: s.type,
    startTime: s.startTime, endTime: s.endTime, duration: s.duration,
    description: s.description, narration: s.narration || '',
    first_frame_prompt: s.first_frame_prompt, last_frame_prompt: s.last_frame_prompt,
    camera_movement: s.camera_movement, character_ids: s.character_ids || [],
  })));

  const effectiveStyle = videoStyle || record.videoStyle || '';
  const creativeBriefBlock = formatCreativeBriefPromptBlock(record.creativeBrief, 'mv');

  return `你是一个专业的 MV 脚本改编专家。请基于以下 MV 分镜脚本，根据用户提示词进行改编。

音乐信息：
${musicInfo}
${effectiveStyle ? `\n画面风格：${effectiveStyle}` : ''}
${creativeBriefBlock ? `\n${creativeBriefBlock}` : ''}
${hasCharacters ? `
当前角色信息：
${characters.map((c: VideoCharacter) => `- ${c.id}（${c.name}）：${c.description}`).join('\n')}
` : ''}
当前分镜脚本：
${shotsJson}
${rewritePrompt ? `\n用户改编提示词：\n${rewritePrompt}` : ''}

${ORIGINAL_CONTENT_GUARDRAIL}

视频生成约束：
- 视频模型：${videoModel}
- ${durationInfo}
- 需要 ${segmentCount} 个视频片段

改编要求（所有字段必须使用与用户提示词相同的语言）：
1. description（画面描述）：根据用户提示词改编画面内容，必须与该时间段的音乐节奏和歌词内容呼应${effectiveStyle ? `，画面风格统一为"${effectiveStyle}"` : ''}
2. narration（旁白）：MV 通常为空字符串
3. first_frame_prompt（首帧图片提示词）：精确描述主体位置、动作起始状态、构图、光线与背景，并写入本镜头独有的视觉锚点、差异化动作起点、构图角度和角色关系，避免只复用同一角色外貌、同一场景和同一泛化风格${hasCharacters ? '；若该镜头有角色，必须包含对应角色的完整外貌描述，并明确沿用同一人物身份、脸型五官、发型、体型、年龄感、完整服装款式、服装颜色、材质和配饰，不得重新设计衣服' : ''}
4. last_frame_prompt（尾帧图片提示词，可为空）：只有该镜头必须独立生成结尾关键帧时才填写，精确描述主体位置、动作定格状态、构图、光线与背景${hasCharacters ? '；若该镜头有角色，必须包含对应角色的完整外貌与服装锚点，和首帧保持同一人物、同一发型、同一套衣服、同一配饰，只改变结尾姿态、表情、动作、镜头角度或环境' : ''}；若下一段首帧自然就是本段尾帧，则填空字符串
5. camera_movement（运镜方式）：根据新内容和音乐节奏适当调整
6. character_ids（角色 ID 列表）：保留或调整角色出场
7. video_style（画面风格）：如果改编后视觉方向变化，必须同步返回新的整体画面风格；如果用户指定了画面风格，则以用户指定为准

角色调整规则（极其重要！）：
- 如果用户提示词要求修改角色（如更换性别、年龄、外貌、服装等），必须在 characters 数组中更新对应角色的 description
- 如果用户提示词要求新增角色，在 characters 数组中添加新角色（id 格式 "char_N"）
- 如果用户提示词要求删除角色，从 characters 数组中移除，并清理相关镜头的 character_ids
- 角色的 description 必须是英文外貌描述，可直接用于文生图

步骤衔接要求：
- 第3步生成首帧/视频时不会继续读取“用户改编提示词”原文；必须把改编意图落实到 description、first_frame_prompt、必要时的 last_frame_prompt、characters 和 video_style 中。
- 用户改编提示词中的故事、相似案例或相似剧情只作背景，不要复述到 first_frame_prompt/last_frame_prompt；每个镜头优先执行音乐时间段、角色一致性和关键帧画面。
- 不要依赖后续生成步骤再理解“改编要求”，每个镜头字段本身要可直接生成。
- 改编后逐镜头检查 first_frame_prompt，不得高度相似；相邻镜头可以共享连续性元素，但必须有清晰不同的动作阶段、构图或角色关系。

拼接衔接要求：
1. 相邻镜头之间必须有共同的视觉元素，确保画面连贯
2. 运镜方向延续，不能突然反向
3. 所有镜头统一色调和光线风格
4. 动作连贯，上一镜头结尾动作延续到下一镜头开头
5. 单段视频模型通常只能生成 8-15 秒；连续超过单段时长的内容应拆成多个连续片段。下一段 first_frame_prompt 只描述当前段起始画面，可包含上一段结尾的短视觉锚点（主体位置、动作瞬间、光线方向），不要写上一段剧情经过；此时上一段 last_frame_prompt 必须留空字符串，生成页会直接复用下一段首帧作为上一段尾帧。
6. 只有最后一段、非连续转场、明确需要独立结束定格或与下一段首帧不一致时，才填写 last_frame_prompt；不要为每段都强行生成尾帧图，非空尾帧只写本镜头结束画面，不写下一镜头剧情。

返回 JSON 对象（不要 markdown 格式），格式如下：
{
  "video_style": "改编后的整体画面风格",
  "characters": [
    { "id": "char_1", "name": "角色名", "description": "English appearance description for text-to-image" }
  ],
  "shots": [ ...镜头数组，每个元素包含 id、startTime、endTime、duration、description、narration、first_frame_prompt、last_frame_prompt、camera_movement、label、type、transition_hint、character_ids 字段... ]
}`;
}
