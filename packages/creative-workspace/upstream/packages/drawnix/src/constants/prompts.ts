/**
 * AI 的默认提示词常量
 */

// AI 图片默认提示词
export const AI_IMAGE_PROMPTS = {
  zh: [
    `产品海报：一款透明玻璃质感的智能水杯放在浅灰色桌面，背景是干净的厨房晨光。
画面保留顶部留白用于标题，主体居中偏下，真实摄影风格，柔和阴影，细节清晰，1:1。`,
    `人物形象：年轻创作者坐在整洁书桌前使用平板绘图，窗边自然光，神情专注。
现代生活方式摄影，色彩清爽，浅景深，主体清晰，适合社交媒体封面，4:5。`,
    `电商主图：一双白色运动鞋悬浮在浅蓝背景前，周围有轻微速度线和水滴元素。
高质感商业摄影，干净背景，突出材质和轮廓，可直接用于商品展示，1:1。`,
    `品牌插画：为效率工具绘制一张扁平矢量插画，包含任务清单、日历、闪电和协作光标。
线条简洁，颜色克制，适合 SaaS 官网首屏，16:9。`,
    `概念场景：未来城市里的无人配送站，清晨薄雾中有机器人分拣包裹。
电影感构图，真实材质，冷暖对比光，细节丰富但画面不杂乱，16:9。`,
  ],
  en: [
    `Product poster: a transparent glass smart water bottle on a light gray tabletop, clean kitchen morning light.
Leave clear space at the top for a headline, subject centered slightly low, realistic photography, soft shadows, crisp details, 1:1.`,
    `Character image: a young creator drawing on a tablet at a tidy desk near a window, focused expression.
Modern lifestyle photography, fresh colors, shallow depth of field, clear subject, suitable for a social cover, 4:5.`,
    `E-commerce hero image: white running shoes floating on a pale blue background with subtle speed lines and water droplets.
Premium commercial photography, clean backdrop, emphasize material and silhouette, ready for product display, 1:1.`,
    `Brand illustration: create a flat vector illustration for a productivity tool with task list, calendar, lightning bolt, and collaboration cursor.
Clean lines, restrained colors, suitable for a SaaS hero section, 16:9.`,
    `Concept scene: an autonomous delivery hub in a future city, robots sorting parcels in early morning mist.
Cinematic composition, realistic materials, cool-warm contrast lighting, rich details without clutter, 16:9.`,
  ]
} as const;

// AI 视频默认提示词
export const AI_VIDEO_PROMPTS = {
  zh: [
    `产品展示视频：一款智能手表在深色桌面上缓慢旋转，屏幕亮起显示健康数据。
镜头从超近景滑到中景，金属边框有细腻高光，节奏稳定，适合 8 秒广告。`,
    `人物短片：创作者在咖啡馆整理灵感板，便利贴、平板和笔记本依次入镜。
手持轻微移动，暖色自然光，动作真实流畅，结尾停在完整桌面构图。`,
    `应用场景：电动自行车穿过清晨城市街道，路面有微弱反光，背景行人自然虚化。
低机位跟拍，速度感适中，画面干净，有品牌宣传片质感。`,
    `教程演示：一张空白画布逐步生成流程图节点、连线和高亮标记。
俯视 UI 动效风格，步骤清晰，转场简洁，适合产品功能介绍。`,
    `氛围镜头：雨后植物叶片上的水珠缓慢滑落，远处有柔和散景灯光。
微距摄影，浅景深，安静治愈，动作细腻，循环感自然。`,
  ],
  en: [
    `Product demo video: a smart watch slowly rotates on a dark tabletop, the screen lights up with health data.
Camera glides from extreme close-up to medium shot, refined metal highlights, steady pacing, suitable for an 8-second ad.`,
    `Lifestyle short: a creator organizes an inspiration board in a cafe, sticky notes, tablet, and notebook enter the frame one by one.
Subtle handheld movement, warm natural light, realistic actions, ending on a complete desktop composition.`,
    `Use case: an electric bike rides through early morning city streets, slight reflections on the road, pedestrians softly blurred.
Low-angle tracking shot, moderate speed, clean frame, polished brand-film feel.`,
    `Tutorial demo: a blank canvas gradually creates flowchart nodes, connectors, and highlight marks.
Top-down UI motion style, clear steps, simple transitions, suitable for a product feature intro.`,
    `Atmospheric shot: raindrops slowly slide across plant leaves after rain, soft bokeh lights in the distance.
Macro photography, shallow depth of field, quiet healing mood, delicate motion, natural loop feel.`,
  ]
} as const;

// AI 音频默认提示词
export const AI_AUDIO_PROMPTS = {
  zh: [
    '创作一段温柔治愈的钢琴纯音乐，节奏舒缓，适合作为夜晚阅读或冥想背景。',
    '生成一首轻快的城市流行歌曲，明亮鼓点，朗朗上口的副歌，适合短视频开场。',
    '写一段梦幻电子氛围音乐，层次逐渐推进，适合作为科技产品宣传片配乐。',
    '生成一段电影预告片风格配乐，从低沉铺垫逐步推向高潮，结尾有清晰记忆点。',
  ],
  en: [
    'Compose a soft healing piano instrumental with a slow tempo for reading or meditation.',
    'Generate an upbeat city pop song with bright drums and a catchy chorus for a short video intro.',
    'Create dreamy electronic ambient music with layered progression for a tech product promo.',
    'Generate a cinematic trailer soundtrack that builds from low tension to a memorable climax.',
  ],
} as const;

// AI 文本默认提示词
export const AI_TEXT_PROMPTS = {
  zh: [
    '把下面的信息整理成结构化总结：背景、关键事实、风险、下一步，并提炼 5 个结论。',
    '将这段内容改写得更简洁、更有说服力，适合对外发布，保留关键信息。',
    '根据这个主题生成一份可直接演讲的 Markdown 大纲，包含标题、核心论点和结尾。',
    '把这些零散想法扩展成一段完整文案，语气专业但易懂，避免空泛表达。',
  ],
  en: [
    'Turn the information below into a structured summary: context, key facts, risks, next steps, and 5 takeaways.',
    'Rewrite this content to be more concise and persuasive for external publishing while preserving key information.',
    'Create a presentation-ready Markdown outline with a title, core arguments, and a closing section.',
    'Expand these rough ideas into complete copy with a professional but accessible tone and no vague filler.',
  ],
} as const;

// AI Agent 默认提示词
export const AI_AGENT_PROMPTS = {
  zh: [
    '把这个目标拆解成可执行计划：里程碑、任务清单、优先级、风险和下一步行动。',
    '围绕这个主题生成一份结构清晰的思维导图，突出层级关系、关键节点和遗漏点。',
    '把这段内容转换成流程图方案，明确步骤、判断节点、异常分支和输出结果。',
    '分析这个问题的成因、影响、可选方案和取舍，并给出推荐方案。',
  ],
  en: [
    'Break this goal into an actionable plan: milestones, task list, priorities, risks, and next steps.',
    'Generate a clear mind map for this topic with hierarchy, key branches, and missing areas.',
    'Turn this content into a flowchart outline with steps, decision points, exception paths, and outputs.',
    'Analyze the causes, impact, options, tradeoffs, and recommended approach for this problem.',
  ],
} as const;

// AI 指令项接口 - 用于 AI 输入框的指令建议
export interface InstructionItemData {
  content: string;
  scene: string;  // 适用场景描述
  tips?: string;
}

// AI 指令 - 用于文本模型工作流（AI 输入框使用）
export const AI_INSTRUCTIONS: Record<'zh' | 'en', InstructionItemData[]> = {
  zh: [
    {
      content: '优化提示词并生成',
      scene: '提示词',
      tips: '在生成图片/视频前先调一次文本模型对提示词进行优化'
    },
    {
      content: '生成该角色无背景的各种表情16宫格图',
      scene: '宫格图',
      tips: '调用1次文本模型 + 1次生图模型，一张图排布n张正方形子图（最多16张）'
    }
  ],
  en: [
    {
      content: 'Optimize prompt and generate',
      scene: 'Optimization',
      tips: 'Prompt optimization, Quality improvement, Prompt polishing'
    }
  ]
};

// 冷启动引导提示词 - 用于引导新用户开始使用
export interface ColdStartSuggestion {
  content: string;
  scene: string;
  /** 模型调用说明，介绍该命令会用到的模型概况 */
  tips: string;
  /** 生成类型：image(直接生图)、video(直接生视频)、agent(需要Agent分析) */
  modelType?: 'image' | 'video' | 'text' | 'agent';
}

export const AI_COLD_START_SUGGESTIONS: Record<'zh' | 'en', ColdStartSuggestion[]> = {
  zh: [
    {
      content: '灵感图：咖啡文化品牌视觉，12图',
      scene: '灵感图',
      tips: '调用1次文本模型 + 1次生图模型，生成一组可参考的视觉方向',
      modelType: 'agent',
    },
    {
      content: '宫格图：可爱猫咪表情包，12宫格',
      scene: '宫格图',
      tips: '调用1次文本模型 + 1次生图模型，适合角色表情探索',
      modelType: 'agent',
    },
    {
      content: '创作一个视频：樱花树下的少女，微风吹过，花瓣飘落',
      scene: '视频创作',
      tips: '调用1次文本模型 + 1次生视频模型',
      modelType: 'video',
    },
    {
      content: '画一个AI工作流的流程图',
      scene: 'mermaid图',
      tips: '调用1次文本模型，生成可编辑的流程图',
      modelType: 'agent',
    },
    {
      content: '生成一份关于AI产品规划的PPT',
      scene: 'PPT演示',
      tips: '调用1次文本模型生成大纲，并自动布局为多页幻灯片',
      modelType: 'agent',
    }
  ],
  en: [
    {
      content: 'inspiration board: Coffee culture brand visuals, 12 images',
      scene: 'Inspiration board',
      tips: '1 text model + 1 image model for visual direction exploration',
      modelType: 'agent',
    },
    {
      content: 'grid image: Cute cat emoji pack, 12-panel layout',
      scene: 'Grid image',
      tips: '1 text model + 1 image model for character expression exploration',
      modelType: 'agent',
    },
    {
      content: 'a video: A girl under cherry blossom tree, petals falling in the breeze',
      scene: 'Video creation',
      tips: '1 text model + 1 video model',
      modelType: 'video',
    },
    {
      content: 'Draw a flowchart of AI workflow',
      scene: 'Tech docs',
      tips: '1 text model for an editable flowchart',
      modelType: 'agent',
    },
    {
      content: 'Generate a PPT about AI product planning',
      scene: 'PPT slides',
      tips: '1 text model for outline and auto layout into multi-page slides',
      modelType: 'agent',
    },
  ],
};

// 类型定义
export type Language = 'zh' | 'en';
export type PromptGenerationType =
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'agent'
  | 'ppt-common'
  | 'ppt-slide';
export type PromptPreviewExample =
  | {
      kind: 'image';
      src: string;
      alt: string;
    }
  | {
      kind: 'video';
      src: string;
      alt: string;
      posterSrc?: string;
      playable?: boolean;
    };

const normalizePromptLanguage = (language: Language): Language =>
  language === 'en' ? 'en' : 'zh';

// 获取图片提示词的辅助函数
export const getImagePrompts = (language: Language): readonly string[] => {
  return AI_IMAGE_PROMPTS[normalizePromptLanguage(language)];
};

// 获取视频提示词的辅助函数
export const getVideoPrompts = (language: Language): readonly string[] => {
  return AI_VIDEO_PROMPTS[normalizePromptLanguage(language)];
};

// 获取音频提示词的辅助函数
export const getAudioPrompts = (language: Language): readonly string[] => {
  return AI_AUDIO_PROMPTS[normalizePromptLanguage(language)];
};

// 获取文本提示词的辅助函数
export const getTextPrompts = (language: Language): readonly string[] => {
  return AI_TEXT_PROMPTS[normalizePromptLanguage(language)];
};

// 获取 Agent 提示词的辅助函数
export const getAgentPrompts = (language: Language): readonly string[] => {
  return AI_AGENT_PROMPTS[normalizePromptLanguage(language)];
};

// 获取指定生成类型默认提示词的辅助函数
export const getDefaultPromptsByGenerationType = (
  generationType: PromptGenerationType,
  language: Language
): readonly string[] => {
  switch (generationType) {
    case 'image':
      return getImagePrompts(language);
    case 'video':
      return getVideoPrompts(language);
    case 'audio':
      return getAudioPrompts(language);
    case 'text':
      return getTextPrompts(language);
    case 'agent':
      return getAgentPrompts(language);
    case 'ppt-common':
      return [];
    default:
      return [];
  }
};

// 获取 AI 指令的辅助函数
export const getInstructions = (language: Language): InstructionItemData[] => {
  return AI_INSTRUCTIONS[language];
};

// 获取冷启动引导提示词的辅助函数
export const getColdStartSuggestions = (language: Language): ColdStartSuggestion[] => {
  return AI_COLD_START_SUGGESTIONS[language];
};
