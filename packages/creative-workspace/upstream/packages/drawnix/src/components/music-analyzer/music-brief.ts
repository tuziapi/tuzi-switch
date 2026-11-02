export interface MusicBrief {
  purpose?: string;
  genreStyle?: string;
  vocalStyle?: string;
  energyMood?: string;
  lyricGoal?: string;
}

interface MusicBriefPreset {
  value: string;
  aliases?: string[];
  promptGuidance: string;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compactLabel(value?: string): string {
  const normalized = cleanText(value);
  if (!normalized) {
    return '';
  }

  return normalized
    .split(/[：:，,；;｜|]/)[0]
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .trim();
}

function buildMusicBriefPromptMap(
  presets: MusicBriefPreset[]
): Map<string, string> {
  return new Map(
    presets.flatMap((preset) =>
      [preset.value, compactLabel(preset.value), ...(preset.aliases || [])].map(
        (key) => [key, preset.promptGuidance] as const
      )
    )
  );
}

function findPresetPrompt(
  map: Map<string, string>,
  value?: string
): string {
  const normalized = cleanText(value);
  if (!normalized) {
    return '';
  }

  return map.get(normalized) || map.get(compactLabel(normalized)) || '';
}

export const MUSIC_BRIEF_PURPOSE_PRESETS: MusicBriefPreset[] = [
  {
    value: '普通歌曲创作：面向完整单曲发布，结构完整，旋律与歌词都要好唱',
    aliases: ['歌曲创作', '写歌', '单曲创作'],
    promptGuidance:
      '普通歌曲创作：按完整单曲构思，明确 Intro / Verse / Pre-Chorus / Chorus / Bridge / Outro；主歌负责叙事，副歌负责记忆点，标题、hook 和旋律落点要适合完整收听与发布。',
  },
  {
    value: '歌词创作：歌词先行，突出主题表达、押韵和可演唱性',
    aliases: ['写歌词', '填词'],
    promptGuidance:
      '歌词创作：优先打磨主题、意象、押韵、段落递进和口语化可唱性；歌词要能独立成立，同时给 Suno 留出清晰的旋律结构标签。',
  },
  {
    value: 'Demo 小样：快速形成可试唱版本，方便继续迭代编曲',
    aliases: ['小样', 'Demo'],
    promptGuidance:
      'Demo 小样：保持结构清楚、段落不过度复杂，先产出可试唱的旋律走向和歌词骨架；副歌要有明确 hook，风格标签服务后续编曲探索。',
  },
  {
    value: '短视频爆点：10 秒内建立记忆点，副歌适合剪辑传播',
    promptGuidance:
      '短视频爆点：开场 1-2 句就给出强钩子或强情绪；副歌第一句必须短、准、可截取，适合字幕、卡点、循环播放和二创传播。',
  },
  {
    value: '情绪共鸣：强化故事感和可代入金句，适合完整收听',
    promptGuidance:
      '情绪共鸣：用具体场景承载情绪，避免空泛宣言；主歌铺故事和细节，副歌给可共鸣金句，情绪曲线要有起伏和释放。',
  },
  {
    value: '品牌传播：保留高级感和清晰主题，避免硬广口吻',
    promptGuidance:
      '品牌传播：把品牌价值转成情绪、场景和生活方式表达；避免硬广词、堆卖点和口号腔，副歌可以保留一句自然可记的品牌化核心表达。',
  },
  {
    value: '广告歌/Jingle：短句洗脑，品牌名或口号自然进入 hook',
    aliases: ['广告歌', 'Jingle'],
    promptGuidance:
      '广告歌/Jingle：结构要短促高记忆，重复句和节奏型优先；品牌名、产品利益点或口号要自然嵌入 hook，避免长段叙事。',
  },
  {
    value: '直播/活动暖场：开场抓人，节奏直接，氛围快速升温',
    promptGuidance:
      '直播/活动暖场：弱化复杂叙事，强化节奏、呼喊感、互动感和现场能量；开场适合倒计时、入场、开麦或活动启动。',
  },
  {
    value: '舞台/演出开场：气势明确，适合入场、灯光和现场互动',
    promptGuidance:
      '舞台/演出开场：制造入场气势和现场号召，段落要有明显能量阶梯；副歌适合观众跟唱、举手、喊口号或灯光爆点。',
  },
  {
    value: '影视/音乐视频配乐：歌词意象鲜明，段落有画面推进',
    promptGuidance:
      '影视/音乐视频配乐：歌词要有画面、人物状态和镜头感；段落推进服务剧情或 MV 画面，副歌承担情绪高潮和视觉记忆点。',
  },
  {
    value: '短剧/影视主题曲：服务人物关系、命运感和剧情钩子',
    promptGuidance:
      '短剧/影视主题曲：围绕人物关系、冲突和命运感组织歌词；副歌要像剧集情绪标签，适合片头、片尾或高光剪辑。',
  },
  {
    value: '游戏/二次元角色曲：贴合世界观、人设口吻和燃点',
    promptGuidance:
      '游戏/二次元角色曲：歌词口吻贴合角色身份、阵营、能力或世界观；保留热血、宿命、羁绊或萌点等可识别符号，风格标签可更类型化。',
  },
  {
    value: '儿歌/亲子：旋律简单，词句安全、重复、易学',
    aliases: ['儿歌', '亲子歌曲'],
    promptGuidance:
      '儿歌/亲子：用简单词、短句、重复和积极表达；避免成人化隐喻、复杂情绪和危险行为，副歌要容易跟唱和记忆。',
  },
  {
    value: '校园/毕业纪念：青春叙事，适合合唱与回忆剪辑',
    promptGuidance:
      '校园/毕业纪念：突出同伴、告别、成长和回忆画面；歌词适合多人合唱和纪念视频，副歌要温暖、明亮、可集体跟唱。',
  },
  {
    value: '婚礼/告白：浪漫真诚，适合仪式现场播放',
    promptGuidance:
      '婚礼/告白：表达要真诚、具体、克制甜度；避免过度套路，副歌适合誓言、入场、交换戒指或告白高光。',
  },
  {
    value: '生日/祝福：直接传递祝福，适合定制化姓名和关系',
    promptGuidance:
      '生日/祝福：祝福信息要清楚、温暖、容易唱；可以为姓名、关系、共同经历预留自然位置，结构不宜过长。',
  },
  {
    value: '企业/团队主题曲：积极凝聚，适合年会、团建和宣传片',
    promptGuidance:
      '企业/团队主题曲：强调愿景、协作、成长和行动感；避免空泛套话，副歌要有团队凝聚力和现场合唱感。',
  },
  {
    value: '播客/节目片头：短小识别度高，适合开场标识',
    aliases: ['播客片头', '节目片头'],
    promptGuidance:
      '播客/节目片头：控制篇幅，突出栏目气质、关键词和声音识别度；歌词可更少，hook 要适合反复作为开场标识使用。',
  },
];

export const MUSIC_BRIEF_PURPOSE_OPTIONS = MUSIC_BRIEF_PURPOSE_PRESETS.map(
  (preset) => preset.value
);

const MUSIC_BRIEF_PURPOSE_PROMPT_BY_KEY = buildMusicBriefPromptMap(
  MUSIC_BRIEF_PURPOSE_PRESETS
);

function getMusicBriefPurposePrompt(purpose?: string): string {
  return findPresetPrompt(MUSIC_BRIEF_PURPOSE_PROMPT_BY_KEY, purpose);
}

export const MUSIC_BRIEF_GENRE_PRESETS: MusicBriefPreset[] = [
  {
    value: 'EDM Pop（电子流行）',
    promptGuidance:
      'EDM Pop：突出电子律动、清晰鼓组、合成器铺底和副歌 drop；hook 要适合卡点、循环和高能剪辑。',
  },
  {
    value: 'Mandopop（华语流行）',
    promptGuidance:
      'Mandopop：旋律线要顺口耐听，歌词重视中文语感、情绪递进和副歌金句；避免英文标签感过重。',
  },
  {
    value: 'Synth Pop（合成器流行）',
    promptGuidance:
      'Synth Pop：使用复古或未来感合成器、稳定律动和霓虹质感；歌词适合城市、夜晚、距离感和浪漫情绪。',
  },
  {
    value: 'Hip Hop / Rap（嘻哈/说唱）',
    aliases: ['Hip Hop', 'Rap', '说唱'],
    promptGuidance:
      'Hip Hop / Rap：强化节奏咬字、押韵密度、flow 变化和态度表达；副歌可以更旋律化，方便传播。',
  },
  {
    value: 'R&B（节奏布鲁斯）',
    aliases: ['R&B', '节奏布鲁斯'],
    promptGuidance:
      'R&B：突出律动、转音空间、亲密叙事和丝滑和声；歌词要克制细腻，避免过度口号化。',
  },
  {
    value: 'Folk Pop（民谣流行）',
    promptGuidance:
      'Folk Pop：以吉他、轻打击或温暖原声质感为核心；歌词重视故事细节、生活画面和自然口语。',
  },
  {
    value: 'Rock Pop（摇滚流行）',
    promptGuidance:
      'Rock Pop：突出吉他推动、鼓点冲击和情绪释放；副歌需要有集体跟唱感和更强爆发。',
  },
  {
    value: 'Cinematic Pop（电影感流行）',
    promptGuidance:
      'Cinematic Pop：使用弦乐、钢琴、氛围铺陈和大动态层次；歌词要有画面推进，副歌承担情绪高潮。',
  },
  {
    value: 'Lo-fi（低保真氛围）',
    aliases: ['Lo-fi', 'lofi'],
    promptGuidance:
      'Lo-fi：控制能量和声音密度，突出松弛鼓组、温暖采样、轻微颗粒感和陪伴感；歌词可更少、更内省。',
  },
  {
    value: 'Future Bass（未来贝斯）',
    promptGuidance:
      'Future Bass：突出明亮合成器、弹性 bass、切分律动和情绪化 drop；副歌要有上扬释放感。',
  },
  {
    value: 'Mozart Classical（莫扎特古典主义）',
    aliases: ['Mozart', '莫扎特', '莫扎特风格', '古典主义'],
    promptGuidance:
      'Mozart Classical：参考古典主义时期的优雅、清晰和平衡感；优先使用钢琴、弦乐、木管、室内乐或小型管弦乐编制，旋律轻盈对称，和声明亮，避免现代 EDM 鼓点、重低音和过度电子化音色。',
  },
  {
    value: 'Classical Orchestra（古典管弦乐）',
    aliases: ['古典管弦乐', '管弦乐'],
    promptGuidance:
      'Classical Orchestra：以弦乐、木管、铜管和定音鼓等传统管弦乐编制组织层次；旋律与动机要清晰，动态推进自然，避免流行电音制作语言。',
  },
  {
    value: 'Chamber Classical（室内乐古典）',
    aliases: ['室内乐', '古典室内乐'],
    promptGuidance:
      'Chamber Classical：使用钢琴三重奏、弦乐四重奏或小型室内乐质感；保持精致、克制和旋律对话感，适合优雅、仪式或叙事场景。',
  },
];

export const MUSIC_BRIEF_GENRE_OPTIONS = MUSIC_BRIEF_GENRE_PRESETS.map(
  (preset) => preset.value
);

const MUSIC_BRIEF_GENRE_PROMPT_BY_KEY = buildMusicBriefPromptMap(
  MUSIC_BRIEF_GENRE_PRESETS
);

function getMusicBriefGenrePrompt(genreStyle?: string): string {
  return findPresetPrompt(MUSIC_BRIEF_GENRE_PROMPT_BY_KEY, genreStyle);
}

export const MUSIC_BRIEF_VOCAL_OPTIONS = [
  'female vocal（女声）',
  'male vocal（男声）',
  'child vocal（童声）',
  'children choir（童声合唱）',
  'duet（男女/双人对唱）',
  'rap vocal（说唱人声）',
  'soft breathy vocal（轻柔气声）',
  'powerful belting vocal（高爆发唱腔）',
  'youthful vocal（少年感人声）',
  'cute sweet vocal（可爱甜声）',
  'deep male vocal（低沉男声）',
  'spoken vocal（旁白/念白）',
  'choir backing vocal（合唱和声）',
];

export const MUSIC_BRIEF_ENERGY_OPTIONS = [
  '高能上扬',
  '轻快治愈',
  '热血燃向',
  '甜酷律动',
  '深夜情绪化',
  '浪漫松弛',
  '史诗氛围',
  '克制高级',
];

export const MUSIC_BRIEF_LYRIC_GOAL_OPTIONS = [
  '副歌第一句必须像标题一样可记忆',
  '主歌讲故事，副歌给情绪宣言',
  '保留短句和重复句，方便跟唱',
  '歌词要有适合短视频字幕的金句',
  '避免口水化，意象更高级但仍然好唱',
];

const MUSIC_BRIEF_KEYS: Array<keyof MusicBrief> = [
  'purpose',
  'genreStyle',
  'vocalStyle',
  'energyMood',
  'lyricGoal',
];

export function normalizeMusicBrief(
  brief?: Partial<MusicBrief> | null
): MusicBrief {
  if (!brief || typeof brief !== 'object') {
    return {};
  }

  const normalized: MusicBrief = {};
  for (const key of MUSIC_BRIEF_KEYS) {
    const value = cleanText(brief[key]);
    if (value) {
      normalized[key] = value;
    }
  }
  return normalized;
}

export function hasMusicBrief(brief?: Partial<MusicBrief> | null): boolean {
  return Object.values(normalizeMusicBrief(brief)).some(Boolean);
}

export function areMusicBriefsEqual(
  left?: Partial<MusicBrief> | null,
  right?: Partial<MusicBrief> | null
): boolean {
  const normalizedLeft = normalizeMusicBrief(left);
  const normalizedRight = normalizeMusicBrief(right);
  return MUSIC_BRIEF_KEYS.every(
    (key) => (normalizedLeft[key] || '') === (normalizedRight[key] || '')
  );
}

export function formatMusicBriefSummary(
  brief?: Partial<MusicBrief> | null
): string {
  const normalized = normalizeMusicBrief(brief);
  return [
    normalized.purpose ? `音乐用途：${normalized.purpose}` : '',
    normalized.genreStyle ? `核心曲风：${normalized.genreStyle}` : '',
    normalized.vocalStyle ? `人声/唱法：${normalized.vocalStyle}` : '',
    normalized.energyMood ? `情绪能量：${normalized.energyMood}` : '',
    normalized.lyricGoal ? `歌词目标：${normalized.lyricGoal}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatMusicBriefPromptBlock(
  brief?: Partial<MusicBrief> | null
): string {
  const summary = formatMusicBriefSummary(brief);
  if (!summary) {
    return '';
  }

  const normalized = normalizeMusicBrief(brief);
  const purposePrompt = getMusicBriefPurposePrompt(normalized.purpose);
  const genrePrompt = getMusicBriefGenrePrompt(normalized.genreStyle);

  return [
    '歌曲定位：',
    summary,
    purposePrompt ? `用途场景提示：\n${purposePrompt}` : '',
    genrePrompt ? `曲风创作提示：\n${genrePrompt}` : '',
    '执行要求：歌词、标题和 Suno 风格标签必须服务于以上歌曲定位；如果用户自由描述与歌曲定位冲突，优先保留用户明确主题，同时用歌曲定位约束曲风、人声、情绪和 hook 策略。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function deriveMusicBriefStyleTags(
  brief?: Partial<MusicBrief> | null
): string[] {
  const normalized = normalizeMusicBrief(brief);
  const candidates = [
    compactLabel(normalized.genreStyle),
    compactLabel(normalized.vocalStyle),
    compactLabel(normalized.energyMood),
  ].filter(Boolean);
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const tag of candidates) {
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

export function mergeMusicBriefStyleTags(
  styleTags?: string[] | null,
  brief?: Partial<MusicBrief> | null
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const tag of [
    ...(styleTags || []),
    ...deriveMusicBriefStyleTags(brief),
  ]) {
    const normalized = cleanText(tag);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(normalized);
  }

  return merged;
}
