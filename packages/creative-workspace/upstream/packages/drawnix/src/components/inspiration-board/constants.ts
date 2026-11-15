/**
 * Inspiration Board Constants
 *
 * 灵感创意板块常量配置
 */

import { InspirationCategory, InspirationTemplate } from './types';

/**
 * 每页显示的模版数量
 */
export const ITEMS_PER_PAGE = 3;

const GRID_IMAGE_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8f4ff"/>
      <stop offset="1" stop-color="#fff7ed"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a855f7"/>
      <stop offset="1" stop-color="#f97316"/>
    </linearGradient>
  </defs>
  <rect width="420" height="420" rx="34" fill="url(#bg)"/>
  <rect x="38" y="46" width="344" height="316" rx="22" fill="#ffffff" opacity="0.95"/>
  <g transform="translate(58 116)" stroke="#d8b4fe" stroke-width="3">
    <rect width="86" height="72" rx="14" fill="#fff7ed"/>
    <rect x="108" width="86" height="72" rx="14" fill="#f5f3ff"/>
    <rect x="216" width="86" height="72" rx="14" fill="#fffbeb"/>
    <rect y="92" width="86" height="72" rx="14" fill="#fef2f2"/>
    <rect x="108" y="92" width="86" height="72" rx="14" fill="#eef2ff"/>
    <rect x="216" y="92" width="86" height="72" rx="14" fill="#fff7ed"/>
    <rect y="184" width="86" height="72" rx="14" fill="#f5f3ff"/>
    <rect x="108" y="184" width="86" height="72" rx="14" fill="#fffbeb"/>
    <rect x="216" y="184" width="86" height="72" rx="14" fill="#fef2f2"/>
  </g>
  <circle cx="101" cy="152" r="18" fill="#f97316"/>
  <circle cx="209" cy="152" r="18" fill="#a855f7"/>
  <circle cx="317" cy="152" r="18" fill="#f59e0b"/>
  <circle cx="101" cy="244" r="18" fill="#ef4444"/>
  <circle cx="209" cy="244" r="18" fill="#6366f1"/>
  <circle cx="317" cy="244" r="18" fill="#fb923c"/>
  <circle cx="101" cy="336" r="18" fill="#8b5cf6"/>
  <circle cx="209" cy="336" r="18" fill="#eab308"/>
  <circle cx="317" cy="336" r="18" fill="#f43f5e"/>
  <path d="M356 78l8 10 12-20" fill="none" stroke="url(#accent)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`);

const PPT_OUTLINE_IMAGE_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#eef5ff"/>
      <stop offset="1" stop-color="#e7e2ff"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="420" height="420" rx="34" fill="url(#bg)"/>
  <rect x="34" y="44" width="352" height="318" rx="22" fill="#ffffff" opacity="0.94"/>
  <rect x="34" y="44" width="352" height="52" rx="22" fill="#e8edff"/>
  <rect x="56" y="126" width="160" height="14" rx="7" fill="url(#accent)"/>
  <rect x="56" y="164" width="274" height="12" rx="6" fill="#c7d2fe"/>
  <rect x="56" y="192" width="220" height="12" rx="6" fill="#dbeafe"/>
  <rect x="56" y="244" width="100" height="70" rx="12" fill="#eff6ff" stroke="#93c5fd"/>
  <rect x="186" y="244" width="100" height="70" rx="12" fill="#f5f3ff" stroke="#a78bfa"/>
  <rect x="316" y="244" width="52" height="70" rx="12" fill="#ecfeff" stroke="#67e8f9"/>
  <circle cx="82" cy="279" r="14" fill="#3b82f6"/>
  <circle cx="236" cy="279" r="14" fill="#8b5cf6"/>
  <circle cx="342" cy="279" r="14" fill="#06b6d4"/>
  <path d="M158 279h24M288 279h24" stroke="#94a3b8" stroke-width="8" stroke-linecap="round"/>
  <rect x="56" y="334" width="312" height="10" rx="5" fill="#dbeafe"/>
</svg>`);

const MINDMAP_IMAGE_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f0fdf4"/>
      <stop offset="1" stop-color="#ecfeff"/>
    </linearGradient>
    <linearGradient id="lineA" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22c55e"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="420" height="420" rx="34" fill="url(#bg)"/>
  <rect x="34" y="48" width="352" height="312" rx="22" fill="#ffffff" opacity="0.94"/>
  <g fill="none" stroke="url(#lineA)" stroke-width="3" stroke-linecap="round">
    <path d="M210 210C170 190 150 156 126 128"/>
    <path d="M210 210C170 220 144 252 116 286"/>
    <path d="M210 210C250 184 278 150 312 128"/>
    <path d="M210 210C252 224 280 254 322 292"/>
    <path d="M126 128C108 116 94 110 78 104"/>
    <path d="M312 128C332 116 346 110 362 104"/>
    <path d="M116 286C98 300 82 310 66 324"/>
    <path d="M322 292C342 302 356 312 372 326"/>
  </g>
  <rect x="168" y="178" width="84" height="64" rx="18" fill="#ecfdf5" stroke="#22c55e" stroke-width="3"/>
  <circle cx="210" cy="210" r="16" fill="#22c55e"/>
  <rect x="76" y="98" width="98" height="36" rx="13" fill="#f0fdf4" stroke="#86efac"/>
  <rect x="72" y="270" width="102" height="36" rx="13" fill="#eff6ff" stroke="#93c5fd"/>
  <rect x="262" y="98" width="102" height="36" rx="13" fill="#ecfeff" stroke="#67e8f9"/>
  <rect x="266" y="276" width="108" height="36" rx="13" fill="#f0fdfa" stroke="#5eead4"/>
  <circle cx="96" cy="116" r="7" fill="#22c55e"/>
  <circle cx="96" cy="288" r="7" fill="#3b82f6"/>
  <circle cx="286" cy="116" r="7" fill="#06b6d4"/>
  <circle cx="290" cy="294" r="7" fill="#14b8a6"/>
  <rect x="116" y="112" width="42" height="7" rx="3.5" fill="#bbf7d0"/>
  <rect x="116" y="284" width="44" height="7" rx="3.5" fill="#bfdbfe"/>
  <rect x="306" y="112" width="42" height="7" rx="3.5" fill="#a5f3fc"/>
  <rect x="310" y="290" width="46" height="7" rx="3.5" fill="#99f6e4"/>
</svg>`);

/**
 * 预设灵感模版列表
 */
export const INSPIRATION_TEMPLATES: InspirationTemplate[] = [
  {
    id: 'grid-emoji',
    title: '智能拆分宫格图',
    description: '宫格图，风格统一',
    prompt: '生成16宫格猫咪表情包',
    category: InspirationCategory.GRID,
    imageUrl: GRID_IMAGE_URL,
    badgeColor: 'badge--grid',
    skillId: 'generate_grid_image',
  },
  {
    id: 'ppt-outline',
    title: '生成PPT大纲',
    description: '用参考图片规划配图与页面提示词',
    prompt:
      '生成一份关于「AI 创作工作流」的 PPT 大纲；如果已上传参考图片，请将参考图片作为配图和视觉风格参考。',
    category: InspirationCategory.PPT,
    imageUrl: PPT_OUTLINE_IMAGE_URL,
    badgeColor: 'badge--ppt',
    skillId: 'generate_ppt',
  },
  {
    id: 'mindmap-project',
    title: '项目规划脑图',
    description: '快速生成结构化的思维导图，梳理项目计划',
    prompt:
      '创建一个关于「移动应用开发」的思维导图，包含需求分析、UI设计、前端开发、后端开发、测试上线等主要分支',
    category: InspirationCategory.MINDMAP,
    imageUrl: MINDMAP_IMAGE_URL,
    badgeColor: 'badge--mindmap',
    skillId: 'generate_mindmap',
  },
];

/**
 * 分类对应的颜色配置
 */
export const CATEGORY_COLORS: Record<
  InspirationCategory,
  { bg: string; text: string }
> = {
  [InspirationCategory.VIDEO]: { bg: '#fce7f3', text: '#be185d' },
  [InspirationCategory.IMAGE]: { bg: '#dbeafe', text: '#1d4ed8' },
  [InspirationCategory.MINDMAP]: { bg: '#dcfce7', text: '#15803d' },
  [InspirationCategory.FLOWCHART]: { bg: '#fef3c7', text: '#b45309' },
  [InspirationCategory.PPT]: { bg: '#dbeafe', text: '#1d4ed8' },
  [InspirationCategory.GRID]: { bg: '#f3e8ff', text: '#7c3aed' },
  [InspirationCategory.SVG]: { bg: '#e0e7ff', text: '#4338ca' },
};
