import type { ModelRef } from "../../utils/settings-manager";

export type DiscussionTarget = "image" | "video" | "audio" | "text";
export const discussionTargetLabels: Record<DiscussionTarget, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
};

/** Shared by configured text providers and local Codex; no extra planning call. */
export const discussionImagePlanningInstruction = `
图片计划必须区分“输出文件数量”和“单张画面内容”：
- 用户要 N 张图片/壁纸，默认是 N 个独立文件，不是把 N 个场景拼进一张图。明确的用户数量优先于界面的默认数量。
- 不同主题、不同场景或多条提示词：逐张展开为 N 个 generate_image 步骤，每步 count:1，每个 prompt 完整描述该张作品的主体、场景、构图与共用风格。不要把所有场景塞入同一个 prompt 再 count:N。
- 只说“生成5张好看的动漫壁纸”等宽泛要求时，可以主动设计5个不同场景，分别写5条单图提示词；不要仅在 content 中说不同，next 却重复同一条整批要求。
- 每个 prompt 面向一次单图请求，不写“生成5张”“每张不同场景”“分别生成”等整批调度指令，不依赖“同上”“第2张”等缺失上下文。数量只由 next 步骤和 count 表达。
- 普通独立壁纸在 prompt 中明确“单幅完整画面，不分屏、不拼贴、无分镜”；用户明确要拼图、四格漫画、对比图或分镜板时，保留其多格构图，一张多格图仍算一个输出文件，不能机械拆成多个格子。
- 仅同一画面描述的多次独立变体可以 count>1，此时 prompt 仍只描述一个输出文件，content 需说明是同一提示词的多张变体。
- 提交前核对：sum(count) 等于承诺的输出文件数（每轮最多10个），每个 prompt 与对应那张作品匹配；content 只说“计划/待确认”，不能声称完成生成。
示例：用户要3张不同场景的动漫壁纸，可返回：
{"content":"已拆成3张独立壁纸：樱花校园、霓虹街道、海边日落，请确认后生成。","next":[{"mcp":"generate_image","args":{"prompt":"樱花校园的动漫壁纸，春日逆光、花瓣飘落，统一细腻日系风格，单幅完整画面，不分屏、不拼贴、无分镜。","count":1}},{"mcp":"generate_image","args":{"prompt":"雨夜霓虹街道的动漫壁纸，蓝紫灯光映在路面，统一细腻日系风格，单幅完整画面，不分屏、不拼贴、无分镜。","count":1}},{"mcp":"generate_image","args":{"prompt":"海边日落的动漫壁纸，暖色晚霞与宁静海面，统一细腻日系风格，单幅完整画面，不分屏、不拼贴、无分镜。","count":1}}]}
`;

/**
 * Reject clear batch commands, never try to split natural language into scenes.
 * Deliberate multi-panel compositions and objects inside one image remain valid.
 * This is a conservative guard, not a complete semantic intent classifier.
 */
export function validateDiscussionImagePrompt(prompt: string): void {
  const plural = "(?:[2-9]\\d*|1\\d+|[二两三四五六七八九十百]+|多|若干|数)";
  const chineseBatch = new RegExp(
    `(?:^|[。！？；;\\n])\\s*(?:(?:请|帮我|为我|需要|现在|直接|批量|分别|独立|再|重新)\\s*)*(?:生成|制作|绘制|画出|创作|输出)\\s*(?:共|总共|一共)?\\s*${plural}\\s*(?:张|幅)`,
    "u",
  );
  const englishBatch = /(?:^|[.!?;\n])\s*(?:please\s+)?(?:generate|create|draw|render|produce)\s+(?:a\s+(?:set|batch|series)\s+of\s+)?(?:[2-9]\d*|1\d+|two|three|four|five|six|seven|eight|nine|ten|multiple|several)\s+(?:(?:different|separate|independent|anime|beautiful|high[- ]quality)\s+)*(?:images?|pictures?|wallpapers?|illustrations?|posters?|collages?)\b/i;
  if (chineseBatch.test(prompt) || englishBatch.test(prompt))
    throw new Error(
      "图片计划还把整批要求写在一张图的提示词里，容易生成拼图，本次未提交任务。请在讨论中发送“按每张独立提示词重新规划”；如果要拼图，请描述一张拼图的内容。",
    );
}
export interface DiscussionPlanStep {
  type: DiscussionTarget;
  prompt: string;
  count: number;
  model: string;
  modelRef: ModelRef;
  referenceImages?: string[];
  size?: string | number;
  seconds?: string | number;
  /** User-selected controls only, never model-supplied execution parameters. */
  params?: Record<string, string>;
}
export interface DiscussionPlan {
  version: 1;
  status: "ready" | "started" | "cancelled";
  steps: DiscussionPlanStep[];
}
export function validateDiscussionPlan(plan: DiscussionPlan): void {
  const fail = () => {
    throw new Error("讨论生成计划无效，请保留原数据。");
  };
  if (
    !plan ||
    plan.version !== 1 ||
    !["ready", "started", "cancelled"].includes(plan.status) ||
    !Array.isArray(plan.steps) ||
    !plan.steps.length ||
    plan.steps.length > 10
  )
    fail();
  let total = 0;
  for (const s of plan.steps) {
    if (
      !s ||
      !Object.hasOwn(discussionTargetLabels, s.type) ||
      typeof s.prompt !== "string" ||
      !s.prompt.trim() ||
      s.prompt.length > 50000 ||
      !Number.isInteger(s.count) ||
      s.count < 1 ||
      s.count > 10 ||
      typeof s.model !== "string" ||
      !s.model ||
      !s.modelRef ||
      s.modelRef.modelId !== s.model ||
      !(
        s.modelRef.profileId === null ||
        typeof s.modelRef.profileId === "string"
      ) ||
      Object.keys(s.modelRef).some((k) => !["profileId", "modelId"].includes(k))
    )
      fail();
    total += s.count;
    if (total > 10) fail();
    for (const value of [s.size, s.seconds])
      if (
        value !== undefined &&
        typeof value !== "string" &&
        (typeof value !== "number" || !Number.isFinite(value))
      )
        fail();
    if (
      s.referenceImages !== undefined &&
      (!Array.isArray(s.referenceImages) ||
        s.referenceImages.length > 6 ||
        s.referenceImages.some((v) => typeof v !== "string"))
    )
      fail();
    if (
      s.params !== undefined &&
      (!s.params ||
        typeof s.params !== "object" ||
        Array.isArray(s.params) ||
        Object.keys(s.params).length > 80 ||
        Object.values(s.params).some(
          (v) => typeof v !== "string" || v.length > 50000,
        ))
    )
      fail();
    if (
      Object.keys(s).some(
        (k) =>
          ![
            "type",
            "prompt",
            "count",
            "model",
            "modelRef",
            "referenceImages",
            "size",
            "seconds",
            "params",
          ].includes(k),
      )
    )
      fail();
  }
}
