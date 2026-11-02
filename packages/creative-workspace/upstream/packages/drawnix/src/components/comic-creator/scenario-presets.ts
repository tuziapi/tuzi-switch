import type { ComicPromptInputMode, ComicScenarioPreset } from './types';

export const DEFAULT_COMIC_SCENARIO_ID = 'travel-brochure';

interface ScenarioSeed {
  id: string;
  label: string;
  category: string;
  description: string;
  audience: string;
  style: string;
  pageFocus: string[];
}

const SCENARIO_SEEDS: ScenarioSeed[] = [
  // 商业宣传
  {
    id: 'brochure',
    label: '宣传册',
    category: '商业宣传',
    description: '把产品、服务或目的地包装成多页宣传册。',
    audience: '潜在客户与合作伙伴',
    style: '高端品牌画册，版式清爽，视觉统一',
    pageFocus: ['封面卖点', '核心价值', '场景展示', '信任背书', '行动号召'],
  },
  {
    id: 'product-manual',
    label: '产品手册',
    category: '商业宣传',
    description: '拆解产品功能、优势和使用场景。',
    audience: '产品用户与销售团队',
    style: '科技产品说明图，干净专业，信息清晰',
    pageFocus: ['产品概览', '功能亮点', '使用流程', '对比优势', '购买理由'],
  },
  {
    id: 'investment-deck',
    label: '招商册',
    category: '商业宣传',
    description: '突出项目机会、商业模式和合作收益。',
    audience: '投资人、加盟商与渠道伙伴',
    style: '商务招商视觉，稳重可信，数据感强',
    pageFocus: ['机会背景', '项目优势', '盈利模式', '资源支持', '合作邀请'],
  },
  {
    id: 'brand-album',
    label: '品牌画册',
    category: '商业宣传',
    description: '展示品牌理念、调性和代表作品。',
    audience: '品牌客户与媒体访客',
    style: '品牌视觉大片，精致统一，具有识别度',
    pageFocus: ['品牌理念', '视觉资产', '代表案例', '用户感受', '品牌愿景'],
  },
  {
    id: 'company-profile',
    label: '企业介绍',
    category: '商业宣传',
    description: '讲清企业能力、团队和案例。',
    audience: '客户、候选人和合作方',
    style: '现代企业介绍，可信、简洁、有秩序',
    pageFocus: ['企业定位', '团队能力', '产品服务', '客户案例', '未来方向'],
  },
  {
    id: 'event-guide',
    label: '活动指南',
    category: '商业宣传',
    description: '为活动生成流程、亮点和现场指引。',
    audience: '活动参与者',
    style: '活力活动手册，明快、易读、导览感强',
    pageFocus: ['活动入口', '时间安排', '重点环节', '现场服务', '结束回顾'],
  },
  {
    id: 'course-intro',
    label: '课程介绍',
    category: '商业宣传',
    description: '介绍课程目标、内容和学习收获。',
    audience: '学习者和家长',
    style: '教育课程宣传，亲和、清晰、可信赖',
    pageFocus: ['学习痛点', '课程体系', '课堂体验', '成果展示', '报名引导'],
  },
  {
    id: 'expo-guide',
    label: '展会导览',
    category: '商业宣传',
    description: '生成展位、动线和重点展品导览。',
    audience: '展会观众和参展商',
    style: '展会导览图文，空间感强，信息密度适中',
    pageFocus: ['入口导览', '展区分布', '重点展品', '互动体验', '离场信息'],
  },
  {
    id: 'real-estate-space',
    label: '楼盘/空间介绍',
    category: '商业宣传',
    description: '展示楼盘、商业空间或文旅空间。',
    audience: '购房者、租户与参观者',
    style: '空间设计画册，明亮通透，质感高级',
    pageFocus: ['区位入口', '空间规划', '生活场景', '配套资源', '预约参观'],
  },
  {
    id: 'travel-brochure',
    label: '城市文旅宣传',
    category: '商业宣传',
    description: '把城市、路线或旅行产品做成多页文旅宣传图。',
    audience: '旅行者与高定游客户',
    style: '高定旅行连环画，明亮精致，地域文化突出',
    pageFocus: ['目的地印象', '路线亮点', '美食体验', '人文故事', '旅行收束'],
  },

  // 儿童与教育
  {
    id: 'storybook',
    label: '绘本',
    category: '儿童与教育',
    description: '生成适合儿童阅读的温暖绘本。',
    audience: '儿童与亲子共读家庭',
    style: '温暖绘本插画，角色可爱，色彩柔和',
    pageFocus: ['角色登场', '小冲突', '探索过程', '情感转折', '温暖结尾'],
  },
  {
    id: 'science-reader',
    label: '科普读物',
    category: '儿童与教育',
    description: '把知识点变成易懂的图文科普。',
    audience: '青少年和大众读者',
    style: '科普插画，准确清楚，富有好奇心',
    pageFocus: ['问题引入', '概念解释', '过程拆解', '生活例子', '知识总结'],
  },
  {
    id: 'knowledge-comic',
    label: '知识漫画',
    category: '儿童与教育',
    description: '用漫画方式讲一个知识主题。',
    audience: '学生和自学者',
    style: '轻松知识漫画，分镜清楚，重点突出',
    pageFocus: ['提出问题', '误区对比', '核心知识', '练习应用', '复盘总结'],
  },
  {
    id: 'history-story',
    label: '历史故事',
    category: '儿童与教育',
    description: '把历史事件或时代片段讲成连环画。',
    audience: '历史学习者',
    style: '历史插画，时代细节准确，叙事庄重',
    pageFocus: ['时代背景', '关键人物', '事件推进', '影响结果', '历史启示'],
  },
  {
    id: 'biography',
    label: '人物传记',
    category: '儿童与教育',
    description: '展现人物成长、选择和成就。',
    audience: '学生与人物故事读者',
    style: '传记插画，真实可信，情感克制',
    pageFocus: ['童年背景', '关键选择', '重要挑战', '代表成就', '精神遗产'],
  },
  {
    id: 'classroom-slides',
    label: '课堂课件',
    category: '儿童与教育',
    description: '生成适合课堂讲解的图文页。',
    audience: '教师和学生',
    style: '课堂视觉辅助，简洁明快，重点明确',
    pageFocus: ['课程导入', '知识讲解', '案例演示', '互动练习', '课堂总结'],
  },
  {
    id: 'parent-child-reading',
    label: '亲子阅读',
    category: '儿童与教育',
    description: '强调亲子陪伴和互动提问。',
    audience: '亲子家庭',
    style: '亲子阅读绘本，柔和、安全、互动感强',
    pageFocus: ['亲子场景', '共同发现', '提问互动', '情绪表达', '陪伴结尾'],
  },
  {
    id: 'language-learning',
    label: '语言学习',
    category: '儿童与教育',
    description: '用场景图帮助词汇、句型或对话学习。',
    audience: '语言学习者',
    style: '语言学习卡通图，场景明确，表达自然',
    pageFocus: ['词汇场景', '句型示范', '角色对话', '纠错提示', '复习应用'],
  },
  {
    id: 'experiment-steps',
    label: '实验步骤',
    category: '儿童与教育',
    description: '把实验过程拆成安全清晰的步骤图。',
    audience: '学生和实验课教师',
    style: '实验流程插图，步骤清楚，安全提示醒目',
    pageFocus: ['材料准备', '步骤一', '观察变化', '结果解释', '安全收尾'],
  },
  {
    id: 'campus-publication',
    label: '校园刊物',
    category: '儿童与教育',
    description: '做成校园报道、社团或班级刊物。',
    audience: '师生与家长',
    style: '校园刊物插画，青春、明亮、有记录感',
    pageFocus: ['校园主题', '人物活动', '成果展示', '同学声音', '集体记忆'],
  },

  // 媒体出版
  {
    id: 'newspaper-serial',
    label: '报刊连载',
    category: '媒体出版',
    description: '生成连续报道或连载图文。',
    audience: '报刊读者',
    style: '报刊插画，黑白灰层次清楚，叙事紧凑',
    pageFocus: ['导语', '事件现场', '人物观点', '背景补充', '结尾悬念'],
  },
  {
    id: 'magazine-feature',
    label: '杂志专题',
    category: '媒体出版',
    description: '适合专题报道和视觉专题页。',
    audience: '杂志读者',
    style: '杂志专题视觉，构图讲究，图文高级',
    pageFocus: ['专题封面', '核心观点', '人物/地点', '细节特写', '专题结论'],
  },
  {
    id: 'travel-magazine',
    label: '旅行杂志',
    category: '媒体出版',
    description: '以杂志方式呈现目的地体验。',
    audience: '旅行爱好者',
    style: '旅行杂志插画，电影感、地域感、生活方式感',
    pageFocus: ['目的地开场', '路线体验', '当地人物', '美食风物', '旅行建议'],
  },
  {
    id: 'food-column',
    label: '美食栏目',
    category: '媒体出版',
    description: '围绕菜品、餐厅或城市美食展开。',
    audience: '美食读者',
    style: '美食栏目插画，食物诱人，氛围鲜活',
    pageFocus: ['招牌食物', '制作/来源', '用餐场景', '人物评价', '推荐清单'],
  },
  {
    id: 'interview-profile',
    label: '人物专访',
    category: '媒体出版',
    description: '用多页画面表现人物观点和故事。',
    audience: '媒体读者',
    style: '人物专访视觉，真实、克制、有镜头感',
    pageFocus: ['人物出场', '工作场景', '关键观点', '生活侧面', '金句收尾'],
  },
  {
    id: 'news-explainer',
    label: '新闻图解',
    category: '媒体出版',
    description: '把复杂新闻拆成可视化解释。',
    audience: '新闻读者',
    style: '新闻信息图插画，客观、清晰、结构化',
    pageFocus: ['发生了什么', '为何重要', '相关各方', '影响范围', '后续关注'],
  },
  {
    id: 'longform-report',
    label: '深度报道',
    category: '媒体出版',
    description: '呈现调查过程、人物和现场。',
    audience: '深度内容读者',
    style: '纪实插画，真实、细节丰富、叙事沉稳',
    pageFocus: ['问题入口', '现场证据', '人物经历', '结构原因', '追问结尾'],
  },
  {
    id: 'cover-story',
    label: '封面故事',
    category: '媒体出版',
    description: '适合杂志封面级主题故事。',
    audience: '杂志与内容平台用户',
    style: '封面故事视觉，强主视觉，高级排版感',
    pageFocus: ['封面画面', '主题展开', '关键人物', '反差细节', '余韵收束'],
  },
  {
    id: 'editorial-comic',
    label: '图文社评',
    category: '媒体出版',
    description: '用图文表达观点、立场和推理。',
    audience: '观点内容读者',
    style: '社评漫画，象征明确，表达克制有力',
    pageFocus: ['观点提出', '现象呈现', '原因分析', '反方提醒', '观点落点'],
  },
  {
    id: 'community-brief',
    label: '社区简报',
    category: '媒体出版',
    description: '记录社区公告、活动和公共服务。',
    audience: '社区居民',
    style: '社区简报插画，亲切、清楚、生活化',
    pageFocus: ['公告主题', '服务信息', '居民参与', '注意事项', '联系方式'],
  },

  // 社交与营销
  {
    id: 'xhs-post',
    label: '小红书图文',
    category: '社交与营销',
    description: '生成适合小红书发布的多页图文。',
    audience: '小红书用户',
    style: '小红书图文，清新、强封面、信息密度适中',
    pageFocus: ['封面钩子', '痛点/亮点', '步骤/清单', '避坑建议', '互动结尾'],
  },
  {
    id: 'moments-long-image',
    label: '朋友圈长图',
    category: '社交与营销',
    description: '适合朋友圈传播的多页图文。',
    audience: '微信好友与私域客户',
    style: '朋友圈长图，温暖真实，轻营销',
    pageFocus: ['情境开场', '真实体验', '重点信息', '价值总结', '轻行动'],
  },
  {
    id: 'wechat-article-images',
    label: '公众号配图',
    category: '社交与营销',
    description: '为公众号文章生成段落配图。',
    audience: '公众号读者',
    style: '公众号配图，稳重耐看，主题统一',
    pageFocus: ['文章开场', '核心论点', '案例场景', '方法总结', '结尾金句'],
  },
  {
    id: 'short-video-storyboard',
    label: '短视频分镜',
    category: '社交与营销',
    description: '把短视频脚本拆为画面分镜。',
    audience: '短视频创作者',
    style: '短视频 storyboard，镜头明确，节奏强',
    pageFocus: ['开头钩子', '冲突/反差', '展示过程', '高潮画面', '结尾转化'],
  },
  {
    id: 'ad-storyboard',
    label: '广告 storyboard',
    category: '社交与营销',
    description: '用于广告片、TVC 或投放素材前期。',
    audience: '广告创意团队',
    style: '广告分镜图，商业质感，镜头语言清晰',
    pageFocus: ['产品出现', '用户痛点', '解决方案', '品牌记忆点', '购买行动'],
  },
  {
    id: 'festival-posters',
    label: '节日海报组图',
    category: '社交与营销',
    description: '生成节日主题连续海报或祝福组图。',
    audience: '品牌粉丝和社群用户',
    style: '节日海报插画，喜庆但不俗套，系列感强',
    pageFocus: [
      '节日开场',
      '传统元素',
      '产品/品牌融入',
      '祝福场景',
      '收尾海报',
    ],
  },
  {
    id: 'event-recap',
    label: '活动回顾',
    category: '社交与营销',
    description: '把活动过程整理成复盘组图。',
    audience: '参与者、客户和内部团队',
    style: '活动回顾图文，现场感强，重点清楚',
    pageFocus: ['活动开场', '精彩瞬间', '嘉宾/用户', '成果数据', '感谢收尾'],
  },
  {
    id: 'case-breakdown',
    label: '案例拆解',
    category: '社交与营销',
    description: '拆解一个案例的方法、过程和结果。',
    audience: '行业读者和潜在客户',
    style: '案例拆解图文，专业、结构化、可复用',
    pageFocus: ['案例背景', '挑战问题', '解决动作', '结果展示', '可复用经验'],
  },
  {
    id: 'recommendation-note',
    label: '种草笔记',
    category: '社交与营销',
    description: '生成产品或目的地种草图文。',
    audience: '消费决策用户',
    style: '种草笔记插画，真实体验，细节丰富',
    pageFocus: ['吸引点', '使用/体验', '细节优点', '适合人群', '购买/到访建议'],
  },
  {
    id: 'checklist-guide',
    label: '清单攻略',
    category: '社交与营销',
    description: '把攻略、步骤或清单做成多页图。',
    audience: '收藏型内容用户',
    style: '攻略清单图文，清爽、实用、便于截图保存',
    pageFocus: ['总览清单', '准备事项', '步骤拆解', '避坑提醒', '最终总结'],
  },

  // 叙事与娱乐
  {
    id: 'classic-comic',
    label: '连环画',
    category: '叙事与娱乐',
    description: '传统多页连环画叙事。',
    audience: '漫画与故事读者',
    style: '经典连环画，分镜连贯，叙事清楚',
    pageFocus: ['开端', '人物关系', '冲突升级', '转折', '结局'],
  },
  {
    id: 'four-panel-comic',
    label: '四格漫画',
    category: '叙事与娱乐',
    description: '四格或短篇幽默漫画结构。',
    audience: '轻阅读用户',
    style: '四格漫画，表情夸张，节奏干净',
    pageFocus: ['设定', '误会', '反转', '笑点'],
  },
  {
    id: 'multi-page-manga',
    label: '多页漫画',
    category: '叙事与娱乐',
    description: '更丰富的多页剧情漫画。',
    audience: '漫画读者',
    style: '现代漫画，镜头丰富，人物一致',
    pageFocus: ['世界设定', '角色行动', '情绪推进', '高潮', '悬念'],
  },
  {
    id: 'fantasy-adventure',
    label: '奇幻冒险',
    category: '叙事与娱乐',
    description: '奇幻世界、旅程和战斗冒险。',
    audience: '奇幻故事读者',
    style: '奇幻冒险插画，宏大、神秘、角色鲜明',
    pageFocus: ['召唤/启程', '陌生世界', '同伴/敌人', '危机战斗', '发现秘密'],
  },
  {
    id: 'mystery-story',
    label: '悬疑故事',
    category: '叙事与娱乐',
    description: '用多页画面铺设线索和反转。',
    audience: '悬疑读者',
    style: '悬疑漫画，光影强烈，线索可见但克制',
    pageFocus: ['异常开场', '线索出现', '误导', '逼近真相', '反转'],
  },
  {
    id: 'romance-story',
    label: '恋爱故事',
    category: '叙事与娱乐',
    description: '讲述关系、心动和情绪变化。',
    audience: '情感故事读者',
    style: '恋爱漫画，细腻、温柔、有生活感',
    pageFocus: ['初遇', '靠近', '误会/试探', '坦白', '温柔结尾'],
  },
  {
    id: 'urban-daily',
    label: '都市日常',
    category: '叙事与娱乐',
    description: '城市生活、职场和日常小故事。',
    audience: '都市生活读者',
    style: '都市日常漫画，真实、轻松、细节生活化',
    pageFocus: ['日常场景', '小问题', '人物互动', '情绪释放', '生活感收尾'],
  },
  {
    id: 'game-plot',
    label: '游戏剧情',
    category: '叙事与娱乐',
    description: '为游戏任务、剧情或关卡生成分镜。',
    audience: '游戏策划和玩家',
    style: '游戏剧情概念图，动作明确，世界观统一',
    pageFocus: ['任务触发', '地图探索', 'NPC 交互', '挑战战斗', '奖励/伏笔'],
  },
  {
    id: 'character-set',
    label: '角色设定集',
    category: '叙事与娱乐',
    description: '多页展示角色外貌、性格和关系。',
    audience: '创作者和设定读者',
    style: '角色设定集，设计感强，人物统一',
    pageFocus: ['角色正面', '服装道具', '性格动作', '关系图', '代表场景'],
  },
  {
    id: 'worldbuilding',
    label: '世界观设定',
    category: '叙事与娱乐',
    description: '展示一个世界的地点、规则和势力。',
    audience: '创作者和设定爱好者',
    style: '世界观设定图，宏大、细节丰富、系统感强',
    pageFocus: ['世界概览', '地理空间', '规则机制', '势力人物', '故事入口'],
  },

  // 实用说明
  {
    id: 'how-to-guide',
    label: '操作指南',
    category: '实用说明',
    description: '把操作流程做成逐页说明。',
    audience: '普通用户',
    style: '操作指南图，步骤清晰，图标化辅助',
    pageFocus: ['准备条件', '步骤一', '关键操作', '常见问题', '完成确认'],
  },
  {
    id: 'sop-flow',
    label: 'SOP 流程',
    category: '实用说明',
    description: '把标准作业流程可视化。',
    audience: '团队成员和管理者',
    style: 'SOP 流程图文，严谨、清楚、可执行',
    pageFocus: ['流程入口', '职责分工', '关键步骤', '检查标准', '异常处理'],
  },
  {
    id: 'safety-training',
    label: '安全培训',
    category: '实用说明',
    description: '呈现安全风险、规范和应急动作。',
    audience: '员工、学生和公众',
    style: '安全培训插画，警示明确，动作规范',
    pageFocus: ['风险识别', '错误示范', '正确操作', '应急处理', '复盘提醒'],
  },
  {
    id: 'medical-science',
    label: '医疗科普',
    category: '实用说明',
    description: '把健康知识用非诊断方式讲清楚。',
    audience: '大众健康读者',
    style: '医疗科普插画，温和、准确、避免恐吓',
    pageFocus: ['症状/问题', '原理解释', '日常建议', '何时就医', '提醒总结'],
  },
  {
    id: 'legal-science',
    label: '法律科普',
    category: '实用说明',
    description: '解释法律概念、流程或权益。',
    audience: '普通公众',
    style: '法律科普图文，客观、清楚、案例化',
    pageFocus: ['问题场景', '法律概念', '案例对照', '处理步骤', '风险提醒'],
  },
  {
    id: 'policy-explainer',
    label: '政策解读',
    category: '实用说明',
    description: '把政策条款拆成易懂页面。',
    audience: '政策相关群体',
    style: '政策解读图文，正式、清晰、信息分层',
    pageFocus: ['政策对象', '核心变化', '办理流程', '影响说明', '注意事项'],
  },
  {
    id: 'user-manual',
    label: '用户手册',
    category: '实用说明',
    description: '为产品或服务生成用户手册。',
    audience: '产品用户',
    style: '用户手册插图，简洁、准确、低干扰',
    pageFocus: ['功能入口', '基础使用', '高级功能', '问题排查', '支持渠道'],
  },
  {
    id: 'emergency-plan',
    label: '应急预案',
    category: '实用说明',
    description: '展示突发事件下的行动流程。',
    audience: '组织成员和公众',
    style: '应急预案图文，醒目、冷静、步骤明确',
    pageFocus: ['风险发生', '第一反应', '撤离/处置', '联络协作', '恢复复盘'],
  },
  {
    id: 'recipe-tutorial',
    label: '菜谱教程',
    category: '实用说明',
    description: '把菜谱拆成逐步视觉教程。',
    audience: '家庭烹饪用户',
    style: '菜谱教程插画，食材清楚，步骤诱人',
    pageFocus: ['食材准备', '处理食材', '烹饪过程', '装盘细节', '口味提示'],
  },
  {
    id: 'fitness-plan',
    label: '健身计划',
    category: '实用说明',
    description: '展示训练动作、节奏和注意事项。',
    audience: '健身用户',
    style: '健身训练图，动作标准，健康积极',
    pageFocus: ['热身', '动作一', '动作二', '拉伸', '计划建议'],
  },
];

function buildTextPrompt(seed: ScenarioSeed): string {
  return [
    `请为「${seed.label}」创作一组连贯的多页图文。`,
    `主题：请替换为你的具体主题、产品、地点或事件。`,
    `目标读者：${seed.audience}。`,
    `视觉风格：${seed.style}。`,
    `页面重点依次覆盖：${seed.pageFocus.join('、')}。`,
    '要求每页都给出清晰标题、画面剧情/文案、图片提示词，整套角色、色彩和版式保持一致。',
  ].join('\n');
}

function buildJsonPrompt(seed: ScenarioSeed): string {
  return JSON.stringify(
    {
      title: `${seed.label}标题`,
      theme: '请替换为你的具体主题、产品、地点或事件',
      scenario: seed.label,
      audience: seed.audience,
      style: seed.style,
      characters: [
        {
          name: '主角或核心对象',
          description: '请描述人物、产品、品牌或地点的统一视觉特征',
        },
      ],
      pages: seed.pageFocus.map((focus, index) => ({
        title: `${index + 1}. ${focus}`,
        script: `围绕“${focus}”展开本页文案或画面剧情`,
        prompt: `表现“${focus}”的关键画面，保持 ${seed.style}`,
      })),
      visualRules: [
        '整套画风、角色、色彩和版式统一',
        '每页画面重点明确，适合单独成图',
        '如需文字，文字应自然融入画面，避免出现字段名',
      ],
    },
    null,
    2
  );
}

export const COMIC_SCENARIO_PRESETS: ComicScenarioPreset[] = SCENARIO_SEEDS.map(
  (seed) => ({
    ...seed,
    textPrompt: buildTextPrompt(seed),
    jsonPrompt: buildJsonPrompt(seed),
  })
);

export function getComicScenarioPreset(
  scenarioId?: string | null
): ComicScenarioPreset {
  return (
    COMIC_SCENARIO_PRESETS.find((preset) => preset.id === scenarioId) ||
    COMIC_SCENARIO_PRESETS.find(
      (preset) => preset.id === DEFAULT_COMIC_SCENARIO_ID
    ) ||
    COMIC_SCENARIO_PRESETS[0]
  );
}

export function getComicScenarioPrompt(
  scenarioId: string | undefined,
  mode: ComicPromptInputMode
): string {
  const preset = getComicScenarioPreset(scenarioId);
  return mode === 'json' ? preset.jsonPrompt : preset.textPrompt;
}

export function isComicScenarioTemplatePrompt(value: string): boolean {
  const normalized = String(value || '').trim();
  if (!normalized) return true;
  return COMIC_SCENARIO_PRESETS.some(
    (preset) =>
      preset.textPrompt.trim() === normalized ||
      preset.jsonPrompt.trim() === normalized
  );
}

export function getComicScenarioPromptContext(
  scenarioId?: string | null
): string {
  const preset = getComicScenarioPreset(scenarioId);
  const pageGuidance = preset.pageFocus
    .map((focus, index) => `第 ${index + 1} 页：${focus}`)
    .join('；');
  return [
    `创作场景：${preset.category} / ${preset.label}`,
    `场景说明：${preset.description}`,
    `目标读者：${preset.audience}`,
    `场景风格：${preset.style}`,
    `页面引导：${pageGuidance}。如页数不同，请按该场景节奏扩展或合并。`,
    '生成要求：后续页面要延续创作场景和前文视觉/叙事语气，但每页必须有独立的场景引导、画面主体、构图和信息重点，避免只套用统一设定。',
  ].join('\n');
}
