export type VisualStructuredPromptLanguage = 'zh' | 'en';

const VISUAL_STRUCTURED_PROMPT_SCHEMA_ZH = [
  '结构化 JSON 视觉提示词 schema：',
  '- 每个页面图片提示词必须是一个可直接用于图片生成的 JSON 对象，顶层只使用 layout 和 style。',
  '- layout.header 包含 location_title、main_title、subtitle，用于页面顶部地点/分类、主标题和副标题。',
  '- layout.body.content_blocks 包含 block_type、left_column、right_column；左右栏都包含 title 和 content 数组。',
  '- layout.footer.elements 描述页脚、CTA、滚动提示、页码或辅助信息。',
  '- style.background 描述背景、摄影/插画质感、光影、景深和构图。',
  '- style.elements 描述核心视觉元素、图标、建筑、产品、人物、道具或装饰。',
  '- style.colors 使用数组，包含颜色名称、用途和可选 HEX。',
  '- style.fonts 使用数组，描述标题、副标和正文的字体方向。',
  '- 不要输出 subject、scene、negativePrompt 等旧式字段作为顶层字段；如确实需要，放入 style.elements 或对应内容字段中。',
  '',
  '目标结构示例：',
  '{',
  '  "layout": {',
  '    "header": {',
  '      "location_title": "中国 · 广东 | CHINA GUANGDONG",',
  '      "main_title": "潮起岭南 寻味山海",',
  '      "subtitle": "汕头 × 潮州 × 南澳 × 揭阳 · 4天3晚高定纯玩之旅"',
  '    },',
  '    "body": {',
  '      "content_blocks": {',
  '        "block_type": "首页视觉海报",',
  '        "left_column": { "title": "文化与海岸的交响", "content": ["英歌舞非遗脸谱虚影", "民国骑楼复古剪影"] },',
  '        "right_column": { "title": "留白与张力", "content": [] }',
  '      }',
  '    },',
  '    "footer": { "elements": "SCROLL TO DISCOVER 开启寻味之旅" }',
  '  },',
  '  "style": {',
  '    "background": "电影级光影质感，暖色文化元素平滑过渡至蓝色海浪，景深丰富，光影对比高级",',
  '    "elements": "广济桥灯光、南澳长山尾灯塔、高级几何留白排版",',
  '    "colors": ["潮汕非遗红 (#D13B3B)", "南澳海岛蓝 (#1A4B82)", "骑楼复古暖棕 (#B59372)"],',
  '    "fonts": ["主标题：苍劲大气书法体", "副标及正文：现代极简无衬线几何体"]',
  '  }',
  '}',
].join('\n');

const VISUAL_STRUCTURED_PROMPT_SCHEMA_EN = [
  'Structured JSON visual prompt schema:',
  '- Each page image prompt must be a JSON object for image generation with only layout and style at the top level.',
  '- layout.header includes location_title, main_title, subtitle.',
  '- layout.body.content_blocks includes block_type, left_column, right_column; each column includes title and content array.',
  '- layout.footer.elements describes footer, CTA, scroll cue, page number, or auxiliary information.',
  '- style.background describes background, rendering/photography quality, lighting, depth of field, and composition.',
  '- style.elements describes key visual elements, icons, architecture, product, people, props, or decorations.',
  '- style.colors is an array with color names, usage, and optional HEX values.',
  '- style.fonts is an array describing title, subtitle, and body font direction.',
  '- Do not use old top-level fields such as subject, scene, or negativePrompt; fold them into style.elements or the matching content fields if needed.',
].join('\n');

export function buildVisualStructuredPromptSchemaInstruction(
  language: VisualStructuredPromptLanguage = 'zh'
): string {
  return language === 'en'
    ? VISUAL_STRUCTURED_PROMPT_SCHEMA_EN
    : VISUAL_STRUCTURED_PROMPT_SCHEMA_ZH;
}
