import type { ComboOptionGroup } from './ComboInput';

export interface CreativeBrief {
  purpose?: string;
  directorStyle?: string;
  narrativeStyle?: string;
  targetPlatform?: string;
  audience?: string;
  pacing?: string;
  negativePrompt?: string;
}

export type CreativeBriefWorkflow = 'popular_video' | 'mv' | 'generation';

const CREATIVE_BRIEF_KEYS: Array<keyof CreativeBrief> = [
  'purpose',
  'directorStyle',
  'narrativeStyle',
  'targetPlatform',
  'audience',
  'pacing',
  'negativePrompt',
];

export const CREATIVE_PURPOSE_OPTIONS: ComboOptionGroup[] = [
  {
    label: '转化成交',
    options: [
      {
        label: '种草带货',
        value: '种草带货：前三秒给出强钩子，快速建立痛点和使用场景，中段用体验细节证明卖点，结尾明确行动引导',
      },
      {
        label: '口播种草',
        value: '口播种草：人物面对镜头快速建立信任，用痛点、体验、卖点和真实感受推动转化，画面要有产品实拍和生活场景穿插',
      },
      {
        label: '场景带货',
        value: '场景带货：把产品放进真实使用场景，通过人物动作和环境反馈自然证明价值，避免纯摆拍和硬讲参数',
      },
      {
        label: '对比测评',
        value: '对比测评：设置明确测试标准，用前后对比、同类对照或极端场景验证卖点，结论要清晰可信',
      },
      {
        label: '开箱体验',
        value: '开箱体验：从期待、拆封、第一眼、细节、上手到使用结果形成体验链路，让观众有代入感',
      },
      {
        label: '直播引流',
        value: '直播引流：突出限时感、互动感和到场理由，用强节奏口播推动用户进入直播间',
      },
      {
        label: '直播切片',
        value: '直播切片：保留强互动、限时福利和即时成交氛围，镜头语言像真实直播高光，不要过度精修',
      },
      {
        label: '信息流广告',
        value: '信息流广告：开头抓注意力，中段用场景证明价值，结尾保留清晰 CTA，整体表达直接高效',
      },
      {
        label: '私域转化',
        value: '私域转化：强调信任、福利、限时权益和咨询理由，降低行动门槛，引导添加、预约或进入社群',
      },
      {
        label: 'APP/小程序拉新',
        value: 'APP/小程序拉新：突出核心功能、即时收益和使用路径，画面要清楚呈现下载、打开、使用、获得结果',
      },
      {
        label: '课程/服务售卖',
        value: '课程/服务售卖：先呈现用户困境和结果差距，再展示方法框架、案例背书和报名理由，避免空泛承诺',
      },
    ],
  },
  {
    label: '品牌传播',
    options: [
      {
        label: '品牌广告',
        value: '品牌广告：弱化硬卖点，强调品牌气质、情绪记忆点和高级视觉识别，结尾自然露出品牌主张',
      },
      {
        label: '品牌质感片',
        value: '品牌质感片：用统一色彩、材质、人物状态和品牌符号建立高级记忆点，减少直白叫卖',
      },
      {
        label: '品牌形象片',
        value: '品牌形象片：围绕品牌精神、人物状态和核心价值展开，用统一视觉符号建立长期记忆点',
      },
      {
        label: '新品发布',
        value: '新品发布：用悬念、揭晓、核心突破、使用场景和高光收束建立发布会感，兼顾信息量与仪式感',
      },
      {
        label: '品牌升级/焕新',
        value: '品牌升级/焕新：先承接过去认知，再展示新定位、新视觉、新产品或新服务，让变化显得可信且必要',
      },
      {
        label: '活动预热',
        value: '活动预热：制造时间节点、参与理由和期待感，画面节奏逐步升温，结尾给出报名或关注动作',
      },
      {
        label: '幕后纪录',
        value: '幕后纪录：展示团队、工艺、创作过程、失败瞬间和最终成果，增强真实感与信任',
      },
      {
        label: '视觉海报动效',
        value: '视觉海报动效：让画面像可动的海报资产，强调构图、文字层级、符号和节奏，不依赖复杂剧情',
      },
      {
        label: '公益/城市文旅',
        value: '公益/城市文旅：重视真实人物、地域质感和情绪共鸣，用温暖但克制的表达形成传播动机',
      },
    ],
  },
  {
    label: '内容增长',
    options: [
      {
        label: '知识科普',
        value: '知识科普：先抛出反常识问题，再用清晰分层解释，最后总结一个可带走的结论',
      },
      {
        label: '教程步骤',
        value: '教程步骤：按步骤拆解操作，每一步都给出清晰画面证据、关键提醒和结果反馈，适合收藏转发',
      },
      {
        label: '清单攻略',
        value: '清单攻略：用编号、场景和优先级组织信息，节奏紧凑，每条建议都要具体可执行',
      },
      {
        label: '账号涨粉',
        value: '账号涨粉：突出人格魅力、专业标签或固定栏目感，让用户知道为什么要关注以及后续能持续获得什么',
      },
      {
        label: '账号人设',
        value: '账号人设：突出人物身份、专业标签、固定表达方式和栏目感，让观众知道为什么要持续关注',
      },
      {
        label: '热点借势',
        value: '热点借势：快速连接热点情绪与自身信息点，保留梗感和时效性，同时避免喧宾夺主',
      },
      {
        label: '热点解读',
        value: '热点解读：先连接热点情绪，再给出自己的角度和信息增量，保持时效性但不牺牲观点清晰度',
      },
    ],
  },
  {
    label: '剧情情绪',
    options: [
      {
        label: '剧情反转',
        value: '剧情反转：开头制造误判或冲突，中段埋伏笔，结尾反转释放爽点并带出核心信息',
      },
      {
        label: '情绪短片',
        value: '情绪短片：以情绪、氛围和视觉隐喻推进，弱化硬信息，依靠光影、动作和节奏留下余味',
      },
      {
        label: '情侣/家庭故事',
        value: '情侣/家庭故事：围绕关系细节、误会、照顾、陪伴或和解展开，用真实微动作制造共鸣',
      },
      {
        label: '职场/校园段子',
        value: '职场/校园段子：用高频场景、角色冲突和节奏停顿制造笑点，结尾要有可评论的共鸣点',
      },
      {
        label: '悬疑钩子',
        value: '悬疑钩子：用反常细节、延迟揭示和线索递进制造追看感，最后给出解释或留下讨论空间',
      },
    ],
  },
  {
    label: '动画短片',
    options: [
      {
        label: '原创物理喜剧短片',
        value: '原创物理喜剧短片：围绕角色目标、道具机关、夸张反应和连环误会设计原创桥段，少对白或无对白，结尾用反转、脱险或暂时和解释放笑点',
      },
      {
        label: '无对白肢体喜剧',
        value: '无对白肢体喜剧：依靠动作预备、节奏变化、表情停顿、音效节拍和肢体反应推进故事，让观众不用解释也能看懂笑点',
      },
      {
        label: '机关闹剧短片',
        value: '机关闹剧短片：用门、绳子、弹簧、锅碗瓢盆等道具形成连续误触和连锁反应，动作因果必须清楚，笑点逐步升级',
      },
      {
        label: '合家欢卡通冒险',
        value: '合家欢卡通冒险：保持轻松、安全和幽默的冒险感，角色冲突可爱不暴力，画面明亮，适合亲子和全年龄观看',
      },
    ],
  },
  {
    label: '场景行业',
    options: [
      {
        label: '餐饮探店',
        value: '餐饮探店：强调门店氛围、招牌菜、口感瞬间和人均价值，用近景细节刺激食欲并给出到店理由',
      },
      {
        label: '探店打卡',
        value: '探店打卡：按照到店路径、环境氛围、招牌亮点、体验瞬间和消费理由组织镜头，兼顾真实感与种草感',
      },
      {
        label: '餐饮美食',
        value: '餐饮美食：用出餐、拉丝、切开、入口、反应和环境声刺激感官，重点突出招牌菜和到店理由',
      },
      {
        label: '美妆护肤',
        value: '美妆护肤：突出肤感、妆效、使用步骤和前后变化，画面要干净细腻，避免夸大功效',
      },
      {
        label: '服饰穿搭',
        value: '服饰穿搭：围绕身材修饰、场景搭配、材质动态和整体气质展开，重点展示上身效果和搭配逻辑',
      },
      {
        label: '家居生活',
        value: '家居生活：用真实生活动线展示收纳、清洁、舒适或效率提升，让产品自然融入日常',
      },
      {
        label: '城市文旅',
        value: '城市文旅：用地标、街巷、人物、风物和路线感建立目的地记忆，画面要有地域质感和情绪吸引力',
      },
      {
        label: '门店服务',
        value: '门店服务：展示服务流程、专业细节、前后变化和真实反馈，让用户理解为什么值得到店或预约',
      },
      {
        label: '科技数码',
        value: '科技数码：用问题场景、核心参数、实拍体验和效率变化讲清价值，避免只堆功能名词',
      },
      {
        label: '游戏/影视宣发',
        value: '游戏/影视宣发：强调世界观、角色魅力、冲突悬念和高燃瞬间，结尾保留想继续看的钩子',
      },
    ],
  },
  {
    label: '音乐/MV',
    options: [
      {
        label: '音乐 MV',
        value: '音乐 MV：让画面服务于歌曲情绪、节拍和歌词意象，建立视觉符号、表演段落和高潮记忆点',
      },
      {
        label: '舞蹈/唱跳',
        value: '舞蹈/唱跳：突出身体动作、队形变化、节拍卡点和舞台能量，镜头要让动作完整可见且有冲击力',
      },
      {
        label: '歌词视频',
        value: '歌词视频：把歌词转化为场景、动作和符号，而不是简单字幕展示，保持音乐情绪的连贯推进',
      },
      {
        label: '歌词意象短片',
        value: '歌词意象短片：把歌词和情绪转化为场景、动作、物件和光影，不做简单字幕堆叠',
      },
      {
        label: '艺人宣传',
        value: '艺人宣传：强化人物魅力、造型识别、舞台气场和个人故事，让观众记住艺人而不只是记住画面',
      },
      {
        label: '舞蹈卡点',
        value: '舞蹈卡点：围绕动作完整性、节拍重音、队形变化和镜头推拉设计，保证动作清楚且有冲击力',
      },
      {
        label: '艺人视觉预告',
        value: '艺人视觉预告：强化人物造型、舞台气场、表演瞬间和个人符号，让观众记住艺人识别度',
      },
    ],
  },
];

export const DIRECTOR_STYLE_OPTIONS: ComboOptionGroup[] = [
  {
    label: '商业导演',
    options: [
      {
        label: '高质感广告导演',
        value: '高质感广告导演：主体明确，镜头调度克制，布光精确，产品和人物都有稳定高级的商业片质感',
      },
      {
        label: '奢侈品广告导演',
        value: '奢侈品广告导演：构图极简，材质和光泽被精确放大，节奏留白，强调稀缺感、身份感和高级审美',
      },
      {
        label: '美妆时尚导演',
        value: '美妆时尚导演：重视面部特写、肌理、妆容、服装动态和色彩统一，镜头要精致、轻盈、有杂志感',
      },
      {
        label: '食品饮料导演',
        value: '食品饮料导演：用微距、慢动作、质感音效和入口瞬间刺激感官，让食欲、清爽或满足感变得可见',
      },
      {
        label: '快节奏短视频导演',
        value: '快节奏短视频导演：镜头切换利落，动作和字幕节奏紧凑，重点信息前置，适合移动端快速观看',
      },
      {
        label: '电商卖货导演',
        value: '电商卖货导演：镜头服务转化，卖点展示直给，手部操作、对比演示和 CTA 节奏清楚，减少无效氛围镜头',
      },
    ],
  },
  {
    label: '生活真实',
    options: [
      {
        label: '纪录片观察导演',
        value: '纪录片观察导演：强调真实场景、自然表演和现场细节，镜头不过度炫技，保留可信度',
      },
      {
        label: '生活方式导演',
        value: '生活方式导演：用自然光、日常动线和轻表演建立松弛感，让产品或主题像生活的一部分自然出现',
      },
      {
        label: 'Vlog 手持导演',
        value: 'Vlog 手持导演：保留临场感、移动感和第一人称视角，镜头不必完美但要亲近、真实、有陪伴感',
      },
      {
        label: '街头纪实导演',
        value: '街头纪实导演：捕捉城市纹理、路人反应和环境噪声，画面有真实偶然性和社会观察感',
      },
      {
        label: 'UGC 原生导演',
        value: 'UGC 原生导演：模拟用户自发拍摄语感，画面轻设备感、低包装感，但信息表达清楚可信',
      },
    ],
  },
  {
    label: '影像导演',
    options: [
      {
        label: '情绪电影导演',
        value: '情绪电影导演：用光影、景深和留白表达情绪，镜头语言有叙事张力，避免直白堆信息',
      },
      {
        label: '悬疑惊悚导演',
        value: '悬疑惊悚导演：利用遮挡、低照度、反常细节和延迟揭示制造不安，节奏逐步收紧',
      },
      {
        label: '喜剧短片导演',
        value: '喜剧短片导演：强调节奏停顿、表情反应、误会升级和包袱释放，镜头要服务笑点而不是炫技',
      },
      {
        label: '青春校园导演',
        value: '青春校园导演：用明亮光线、奔跑、群像和细微情绪表达成长感、心动感或遗憾感',
      },
      {
        label: '预告片导演',
        value: '预告片导演：开场悬念强，节奏逐步升级，高潮镜头具有冲击力，结尾保留期待感',
      },
    ],
  },
  {
    label: '动画导演',
    options: [
      {
        label: '原创物理喜剧动画导演',
        value: '原创物理喜剧动画导演：以角色目标、物理夸张、道具机关和反应镜头组织段落，强调清晰剪影、强节奏和无对白笑点',
      },
      {
        label: '二维卡通短片导演',
        value: '二维卡通短片导演：镜头像动画分镜一样清楚，角色表演夸张但造型稳定，场景像舞台布景，动作节奏服务笑点',
      },
      {
        label: '无对白肢体喜剧导演',
        value: '无对白肢体喜剧导演：减少台词解释，用动作预备、停顿、反应、夸张后果和音效节拍制造笑点，保证动作因果一眼看懂',
      },
      {
        label: '合家欢动画导演',
        value: '合家欢动画导演：把冲突处理成轻松可爱的冒险，角色受挫不显真实伤害，画面明亮友好，节奏活泼但不压迫',
      },
    ],
  },
  {
    label: '音乐视觉',
    options: [
      {
        label: 'MV 视觉导演',
        value: 'MV 视觉导演：镜头与音乐节奏强绑定，强调情绪曲线、视觉符号和表演调度',
      },
      {
        label: '舞台演出导演',
        value: '舞台演出导演：利用灯光、走位、队形、观众反应和大景别建立现场能量，突出表演完整性',
      },
      {
        label: '概念艺术导演',
        value: '概念艺术导演：以强符号、超现实空间和统一美术设定组织画面，让每个镜头都像专辑视觉资产',
      },
      {
        label: '复古胶片导演',
        value: '复古胶片导演：使用颗粒、旧镜头质感、复古服化道和温暖色彩，营造怀旧、私人和时间感',
      },
      {
        label: '赛博霓虹导演',
        value: '赛博霓虹导演：用高反差灯光、未来城市、屏幕反射和电子色彩制造强烈科技感与夜景冲击',
      },
    ],
  },
  {
    label: '垂类镜头',
    options: [
      {
        label: '科技产品导演',
        value: '科技产品导演：用干净布光、机械运动、屏幕界面和功能演示突出理性、效率和未来感',
      },
      {
        label: '汽车运动导演',
        value: '汽车运动导演：强调速度、线条、路面、内饰细节和驾驶情绪，镜头运动要有力量和方向感',
      },
      {
        label: '旅行风光导演',
        value: '旅行风光导演：通过大景别、移动视角、人物背影和地域细节建立向往感，让目的地可感可达',
      },
      {
        label: '家居空间导演',
        value: '家居空间导演：重视空间层次、自然光、材质触感和生活动线，让环境看起来真实、舒服、有秩序',
      },
      {
        label: '运动健康导演',
        value: '运动健康导演：突出身体状态、呼吸节奏、汗水细节和力量释放，镜头要清爽、积极、可信',
      },
    ],
  },
];

export const NARRATIVE_STYLE_OPTIONS: ComboOptionGroup[] = [
  {
    label: '转化结构',
    options: [
      {
        label: '痛点-解决-转化',
        value: '痛点-解决-转化：先呈现具体痛点，再展示解决过程和结果，最后给出明确行动理由',
      },
      {
        label: 'AIDA',
        value: 'AIDA：先吸引注意，再激发兴趣，随后建立欲望，最后推动行动，适合广告和成交导向内容',
      },
      {
        label: 'PAS',
        value: 'PAS：先指出问题，再放大后果或情绪，再给出解决方案，适合痛点强、转化明确的视频',
      },
      {
        label: '前后对比',
        value: '前后对比：用使用前后的状态差异推动叙事，必须让变化可视化、可信，并在结尾总结关键原因',
      },
      {
        label: '功能演示',
        value: '功能演示：按真实使用步骤展示功能、过程和结果，镜头必须清楚呈现操作路径与价值变化',
      },
      {
        label: '场景种草',
        value: '场景种草：围绕真实使用场景展开，让卖点自然嵌入人物动作和生活细节',
      },
    ],
  },
  {
    label: '爆款短视频',
    options: [
      {
        label: '反转爽点',
        value: '反转爽点：前半段制造误解或冲突，后半段用反转释放爽点并带出核心信息',
      },
      {
        label: '三秒钩子',
        value: '三秒钩子：开头用反常识、强结果、冲突或悬念抢注意力，随后快速兑现，不让观众等待太久',
      },
      {
        label: '问题挑战',
        value: '问题挑战：用一个明确问题或挑战贯穿全片，中段不断推进难度，结尾给出答案或结果',
      },
      {
        label: '误会递进',
        value: '误会递进：开头制造错误判断，中段逐步加深误会，最后用反转解释真相并释放传播点',
      },
      {
        label: '清单盘点',
        value: '清单盘点：用编号、对比和递进排列信息，每一点都要有画面证据，适合知识、测评和攻略',
      },
      {
        label: '第一人称 POV',
        value: '第一人称 POV：让观众代入角色视角，通过动作、环境反馈和内心独白推进体验',
      },
    ],
  },
  {
    label: '动画喜剧',
    options: [
      {
        label: '冲突升级',
        value: '冲突升级：从简单目标或误会开始，每个镜头叠加新障碍、新道具和新反转，速度与混乱感逐步升高，最后用大包袱收束',
      },
      {
        label: '机关连锁反应',
        value: '机关连锁反应：前一动作误触下一道具，形成清晰连续的动作因果链，观众能预判危险但角色来不及反应',
      },
      {
        label: '无对白肢体喜剧',
        value: '无对白肢体喜剧：减少旁白和对白，依靠动作预备、夸张表情、停顿、节奏变化和反应镜头完成叙事',
      },
      {
        label: '误会到反转和解',
        value: '误会到反转和解：前段建立角色误会或目标冲突，中段让双方被同一个意外牵连，结尾用反转、共同脱险或短暂和解制造记忆点',
      },
    ],
  },
  {
    label: '故事叙事',
    options: [
      {
        label: '情绪递进',
        value: '情绪递进：从铺垫到推进再到高潮，镜头和文案都服务于清晰的情绪曲线',
      },
      {
        label: '三幕式短片',
        value: '三幕式短片：建立人物与目标，制造阻碍和选择，最后完成转变或揭示结果，适合剧情短片',
      },
      {
        label: '英雄旅程',
        value: '英雄旅程：让主角从困境出发，经历召唤、试炼和改变，最终回到现实并带来启发',
      },
      {
        label: '悬念揭示',
        value: '悬念揭示：开头抛出谜面，中段提供线索但不完全解释，结尾揭示答案并形成记忆点',
      },
      {
        label: '双线并行',
        value: '双线并行：两条人物、时间或空间线索交替推进，在高潮处汇合，制造对照和情绪共振',
      },
      {
        label: '开放式结尾',
        value: '开放式结尾：保留未完全解释的余味或选择空间，适合情绪、艺术和品牌态度类内容',
      },
    ],
  },
  {
    label: '音乐/MV叙事',
    options: [
      {
        label: '歌词画面化',
        value: '歌词画面化：把歌词意象转成可见动作、场景和符号，避免只做字面复述',
      },
      {
        label: '无旁白视觉叙事',
        value: '无旁白视觉叙事：尽量减少口播，用动作、构图、转场和视觉符号推动叙事',
      },
      {
        label: '表演-剧情交织',
        value: '表演-剧情交织：在演唱、舞蹈或演奏段落与故事段落之间切换，让表演承载情绪、剧情承载意义',
      },
      {
        label: '视觉母题循环',
        value: '视觉母题循环：设定一个反复出现的物件、颜色、动作或空间，在不同段落中变奏并强化记忆',
      },
      {
        label: '节拍蒙太奇',
        value: '节拍蒙太奇：根据鼓点、重拍和旋律变化安排切镜、动作和转场，让音乐结构直接驱动画面结构',
      },
      {
        label: '高潮爆发',
        value: '高潮爆发：前段压抑或铺垫，中后段用光、动作、空间和剪辑密度集中释放情绪能量',
      },
    ],
  },
  {
    label: '纪实表达',
    options: [
      {
        label: '人物小传',
        value: '人物小传：围绕人物身份、困境、选择和变化展开，用细节和动作建立真实感，而非只做访谈摘要',
      },
      {
        label: '一天时间线',
        value: '一天时间线：按照早中晚或事件推进组织内容，让产品、人物或地点在真实时间流中自然出现',
      },
      {
        label: '案例复盘',
        value: '案例复盘：先给结果，再回看背景、过程、关键动作和可复用经验，适合服务、教育和 B2B 内容',
      },
      {
        label: '街访反应',
        value: '街访反应：以真实反馈和即时反应为叙事核心，问题要锋利，剪辑保留多样观点和情绪变化',
      },
      {
        label: '幕后花絮',
        value: '幕后花絮：展示制作过程、团队协作、失败瞬间和最终成果，让观众感到亲近并增强信任',
      },
    ],
  },
  {
    label: '高级表达',
    options: [
      {
        label: '视觉隐喻',
        value: '视觉隐喻：用象征物、空间变化或动作重复表达抽象概念，让主题通过画面被理解而非被解释',
      },
      {
        label: '诗性散文',
        value: '诗性散文：弱化强情节，依靠意象、节奏、旁白或字幕形成情绪流动，适合品牌和情绪短片',
      },
      {
        label: '黑色幽默',
        value: '黑色幽默：用荒诞、反差和冷处理表达尖锐观点，结尾要留下出人意料但合理的讽刺点',
      },
      {
        label: '群像交叉',
        value: '群像交叉：多个角色围绕同一主题或场景交替出现，用差异化反应形成丰富视角和社会感',
      },
      {
        label: '循环闭环',
        value: '循环闭环：结尾回到开头的画面、台词或动作，但意义发生变化，形成完整、精巧的结构感',
      },
    ],
  },
];

export const TARGET_PLATFORM_OPTIONS = [
  '竖屏短视频信息流',
  '生活方式内容社区',
  '视频号',
  '中长视频社区横屏',
  '海外竖屏短视频',
  '儿童/合家欢横屏动画',
  '品牌官网 / 发布会',
];

export const AUDIENCE_OPTIONS = [
  '泛人群',
  '年轻女性',
  '年轻男性',
  '宝妈/家庭用户',
  '亲子/合家欢用户',
  '职场人群',
  '潮流消费人群',
  '专业/发烧友人群',
];

export const PACING_OPTIONS = [
  '前三秒强钩子，全程快节奏',
  '前快后稳，中段充分展示细节',
  '音乐驱动，随节拍切镜',
  '物理喜剧，预备-爆发-反应-升级循环',
  '情绪递进，结尾爆发',
  '舒缓高级，重氛围和质感',
];

function prioritizeOptionGroups(
  groups: ComboOptionGroup[],
  priorityLabels: string[]
): ComboOptionGroup[] {
  const priority = new Map(priorityLabels.map((label, index) => [label, index]));
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const aPriority = priority.get(a.group.label);
      const bPriority = priority.get(b.group.label);
      if (aPriority !== undefined && bPriority !== undefined) {
        return aPriority - bPriority;
      }
      if (aPriority !== undefined) return -1;
      if (bPriority !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ group }) => group);
}

export function getCreativeBriefPresetOptions(
  workflow: CreativeBriefWorkflow = 'popular_video'
): {
  purposeOptions: ComboOptionGroup[];
  directorStyleOptions: ComboOptionGroup[];
  narrativeStyleOptions: ComboOptionGroup[];
} {
  if (workflow !== 'mv') {
    return {
      purposeOptions: CREATIVE_PURPOSE_OPTIONS,
      directorStyleOptions: DIRECTOR_STYLE_OPTIONS,
      narrativeStyleOptions: NARRATIVE_STYLE_OPTIONS,
    };
  }

  return {
    purposeOptions: prioritizeOptionGroups(CREATIVE_PURPOSE_OPTIONS, [
      '音乐/MV',
      '剧情情绪',
      '品牌传播',
      '内容增长',
    ]),
    directorStyleOptions: prioritizeOptionGroups(DIRECTOR_STYLE_OPTIONS, [
      '音乐视觉',
      '影像导演',
      '生活真实',
    ]),
    narrativeStyleOptions: prioritizeOptionGroups(NARRATIVE_STYLE_OPTIONS, [
      '音乐/MV叙事',
      '故事叙事',
      '高级表达',
    ]),
  };
}

export const CREATIVE_BRIEF_EMPTY: CreativeBrief = {};

export function normalizeCreativeBrief(brief?: Partial<CreativeBrief> | null): CreativeBrief {
  if (!brief) return CREATIVE_BRIEF_EMPTY;
  const normalized: CreativeBrief = {};
  for (const key of CREATIVE_BRIEF_KEYS) {
    const value = brief[key];
    if (typeof value === 'string' && value.trim()) {
      normalized[key] = value.trim();
    }
  }
  return normalized;
}

export function hasCreativeBrief(brief?: Partial<CreativeBrief> | null): boolean {
  const normalized = normalizeCreativeBrief(brief);
  return Object.values(normalized).some(Boolean);
}

export function formatCreativeBriefSummary(brief?: Partial<CreativeBrief> | null): string {
  const normalized = normalizeCreativeBrief(brief);
  return [
    normalized.purpose ? `视频用途/场景：${normalized.purpose}` : '',
    normalized.directorStyle ? `导演风格：${normalized.directorStyle}` : '',
    normalized.narrativeStyle ? `叙事/编剧风格：${normalized.narrativeStyle}` : '',
    normalized.targetPlatform ? `目标平台：${normalized.targetPlatform}` : '',
    normalized.audience ? `目标受众：${normalized.audience}` : '',
    normalized.pacing ? `节奏策略：${normalized.pacing}` : '',
    normalized.negativePrompt ? `避免：${normalized.negativePrompt}` : '',
  ].filter(Boolean).join('\n');
}

export function formatCreativeBriefPromptBlock(
  brief?: Partial<CreativeBrief> | null,
  workflow: CreativeBriefWorkflow = 'generation'
): string {
  const summary = formatCreativeBriefSummary(brief);
  if (!summary) return '';

  const workflowRules =
    workflow === 'popular_video'
      ? [
          '执行要求：根据视频用途/场景调整开场钩子、卖点顺序、口播密度、镜头内容形态、表演方式、信息密度和 CTA 强度。',
          '导演风格约束镜头语言与画面调度；叙事/编剧风格约束故事结构和信息释放顺序。',
        ]
      : workflow === 'mv'
        ? [
            '执行要求：视频用途/场景决定画面段落形态；导演风格约束镜头语言、表演调度和光影；叙事/编剧风格约束情绪曲线、歌词画面化和段落推进。',
            '必须让画面节奏服务于音乐节拍、歌词意象和用户选择的视频方向。',
          ]
        : [
            '执行要求：单镜头生成必须继承导演风格、节奏策略、平台受众和避免项，不得偏离当前创作 Brief。',
          ];

  return ['创作 Brief：', summary, ...workflowRules].join('\n');
}
