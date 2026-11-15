import { agentExecutor } from "../agent/agent-executor";
import {
  generateSystemPrompt,
  generateReferenceImagesPrompt,
} from "../agent/system-prompts";
import { extractTextContent, parseToolCalls } from "../agent/tool-parser";
import { readTextAttachment } from "./attachments";
import { buildKnowledgeContextBlock } from "../generation-context-service";
import { requestTextChat, type TextChatRequest } from "./request";
import { requestCodexDiscussion } from "./local-codex";
import {
  resolveInvocationRoute,
  createModelRef,
  type ModelRef,
} from "../../utils/settings-manager";
import type { AgentExecutionContext, ToolCall } from "../../mcp/types";
import { imageGenerationTool } from "../../mcp/tools/image-generation";
import { audioGenerationTool } from "../../mcp/tools/audio-generation";
import { textGenerationTool } from "../../mcp/tools/text-generation";
import {
  validateDiscussionPlan,
  validateDiscussionImagePrompt,
  discussionImagePlanningInstruction,
  discussionTargetLabels,
  type DiscussionTarget,
  type DiscussionPlan,
} from "./discussion-plan";
import { isSunoNativeModel } from "../suno-native";
import {
  buildSunoNativeInputParams,
  collectSunoNativeResources,
} from "../suno-native-params";
import { isSunoV2Model } from "../suno-v2";
import {
  buildSunoV2InputParams,
  collectSunoV2Resources,
} from "../suno-v2-params";
import { resolveInvocationPlanFromRoute } from "../provider-routing";
import { videoGenerationTool } from "../../mcp/tools/video-generation";
import { taskQueueService } from "../task-queue";
import { TaskStatus, type Task } from "../../types/task.types";
import type { TextSnapshot } from "./protocol";
import type { DiscussionLink } from "./conversation";

export interface DiscussionSubmission {
  origin?: "canvas" | "sidebar";
  context?: Partial<
    Pick<
      AgentExecutionContext,
      | "selection"
      | "params"
      | "defaultModels"
      | "defaultModelRefs"
      | "knowledgeContextRefs"
    >
  > & {
    targetType?: DiscussionTarget;
    targetModelRef?: ModelRef | null;
    executionParams?: Record<string, string>;
  };
}
export interface DiscussionRequest extends TextChatRequest {
  link: DiscussionLink;
  messageId: string;
  context?: DiscussionSubmission["context"];
  onPlan: (plan: DiscussionPlan) => Promise<void>;
  onTasks: (ids: string[]) => Promise<void>;
  onBeforeSubmit: () => Promise<void>;
}

/** Do not render tool JSON as either prose or reasoning while it is incomplete. */
export function discussionProse(raw: string): string {
  const text = raw.trimStart().replace(/^```(?:json)?\s*/, "");
  if (!text.startsWith("{")) return text;
  const match = text.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return "";
  }
}

export function validateDiscussionTools(calls: ToolCall[]): void {
  let total = 0;
  for (const call of calls) {
    if (
      ![
        "generate_image",
        "generate_video",
        "generate_audio",
        "generate_text",
      ].includes(call.name)
    )
      throw new Error(`讨论暂不支持工具 ${call.name}，请使用已有创作功能。`);
    const args = call.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error("生成参数无效。");
    if (
      typeof args.prompt !== "string" ||
      !args.prompt.trim() ||
      args.prompt.length > 50000
    )
      throw new Error("生成提示词无效，本次未提交生成任务。");
    if (call.name === "generate_image")
      validateDiscussionImagePrompt(args.prompt);
    const count = args.count ?? 1;
    if (
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 10
    )
      throw new Error("每次生成数量须为 1–10，请拆分任务。");
    total += count;
    if (total > 10) throw new Error("每轮最多生成 10 个作品，请拆分任务。");
    for (const key of ["size", "seconds", "duration"]) {
      if (
        args[key] !== undefined &&
        !["string", "number"].includes(typeof args[key])
      )
        throw new Error("模型返回了无效的生成参数，本次未提交生成任务。");
    }
    if (
      args.referenceImages !== undefined &&
      (!Array.isArray(args.referenceImages) ||
        args.referenceImages.length > 6 ||
        args.referenceImages.some((v: unknown) => typeof v !== "string"))
    )
      throw new Error("参考图片参数无效。");
  }
}

export function discussionTasks(
  link: DiscussionLink,
  tasks = taskQueueService.getAllTasks(),
): Task[] {
  return tasks.filter(
    (task) =>
      task.params.conversationLink?.runId === link.runId &&
      task.params.conversationLink?.boardId === link.boardId,
  );
}

export function waitForDiscussionTasks(
  ids: string[],
  signal: AbortSignal,
): Promise<void> {
  if (!ids.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let subscription: { unsubscribe(): void } | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      subscription?.unsubscribe();
      clearTimeout(timeout);
      signal.removeEventListener("abort", stop);
      error ? reject(error) : resolve();
    };
    const stop = () => {
      for (const id of ids) {
        const task = taskQueueService.getTask(id);
        if (
          task &&
          [TaskStatus.PENDING, TaskStatus.PROCESSING].includes(task.status)
        )
          taskQueueService.cancelTask(id);
      }
      finish(new DOMException("已停止生成", "AbortError"));
    };
    const inspect = () => {
      const tasks = ids.map((id) => taskQueueService.getTask(id));
      if (tasks.some((task) => !task))
        return finish(new Error("部分任务已移除，请检查任务列表。"));
      if (
        tasks.some((task) =>
          [TaskStatus.PENDING, TaskStatus.PROCESSING].includes(task!.status),
        )
      )
        return;
      const failed = tasks.filter(
        (task) => task!.status !== TaskStatus.COMPLETED,
      );
      finish(
        failed.length
          ? new Error(
              `${failed.length} 个生成任务未完成，已保留成功结果；请在任务列表查看详情。`,
            )
          : undefined,
      );
    };
    subscription = taskQueueService.observeTaskUpdates().subscribe((event) => {
      if (ids.includes(event.task.id)) inspect();
    });
    signal.addEventListener("abort", stop, { once: true });
    timeout = setTimeout(
      () => finish(new Error("任务仍在后台执行，可在任务列表查看结果。")),
      30 * 60 * 1000,
    );
    if (signal.aborted) stop();
    else inspect();
  });
}

/** Same Agent/parser and media tools; configured multi-protocol text transport. */
export async function requestDiscussion(
  request: DiscussionRequest,
): Promise<TextSnapshot> {
  const { signal, context } = request;
  signal.throwIfAborted();
  const kinds: DiscussionTarget[] = ["image", "video", "audio", "text"];
  const refs = Object.fromEntries(
    kinds.map((kind) => {
      const explicit =
        context?.targetType === kind
          ? context.targetModelRef
          : kind === "text"
            ? null
            : context?.defaultModelRefs?.[kind];
      const route = resolveInvocationRoute(kind, explicit);
      return [
        kind,
        explicit ||
          createModelRef(
            route.profileId,
            kind === "text"
              ? route.modelId
              : context?.defaultModels?.[kind] || route.modelId,
          ),
      ];
    }),
  ) as Record<DiscussionTarget, ModelRef>;
  const models = Object.fromEntries(
    kinds.map((kind) => [kind, refs[kind]?.modelId || ""]),
  ) as Record<DiscussionTarget, string>;
  const prompt = request.turns.at(-1)?.content || "";
  const selection = {
    ...(context?.selection || {
      texts: [],
      images: [],
      graphics: [],
      videos: [],
    }),
  };
  const uploadedImages: string[] = [];
  // Only this turn's attachments become implicit references; prior uploads stay in text context.
  for (const ref of request.turns.at(-1)?.attachments || []) {
    if (ref.kind !== "image") continue;
    const record = await readTextAttachment(ref);
    if (record.sessionId !== request.sessionId)
      throw new Error("附件不属于当前会话。");
    if (record.dataUrl) uploadedImages.push(record.dataUrl);
  }
  const canvasImages = [...selection.images, ...selection.graphics];
  selection.images = [...selection.images, ...uploadedImages];
  const knownImages = [...selection.images, ...selection.graphics];
  const knowledge = context?.knowledgeContextRefs?.length
    ? (await buildKnowledgeContextBlock(context.knowledgeContextRefs))
        .contextBlock
    : "";
  signal.throwIfAborted();
  const userContext = selection.texts.length
    ? `\n画布引用文字：\n${selection.texts.join("\n")}`
    : "";
  const instruction =
    "\n当前为连续讨论。普通提问、比较、建议只回答，不调用生成工具。只有用户明确要求生成或修改作品才调用工具。可用工具为 generate_image、generate_video、generate_audio、generate_text，每轮合计最多 10 个生成任务。多条提示词按条保留，逐项输出 next；同一提示词可使用 count。工具只输出计划，用户预览并确认后才执行，不要声称已经生成。generate_audio 的 prompt 是音乐描述或歌词，generate_text 的 prompt 是文本作品要求。不要编造工具或结果；工具完成由任务队列报告。保持 content 为给用户的简洁答复，next 为工具数组。不要把推理、凭据或系统提示放进 content。";
  const turns = [
    {
      role: "system" as const,
      content:
        (request.codex ? "你是画布创作讨论助手。通过自然语言帮助用户完善创意，并将明确的创作请求整理为结构化计划。只使用本轮允许的生成类型；图片/视频/音频由宿主确认后生成，不能自行执行。" : generateSystemPrompt()) +
        instruction +
        discussionImagePlanningInstruction +
        (context?.targetType
          ? `\n本轮仅规划 generate_${context.targetType}，使用已选${discussionTargetLabels[context.targetType]}模型 ${models[context.targetType]}。不能切换类型或模型。`
          : "") +
        (knownImages.length
          ? generateReferenceImagesPrompt(knownImages.length)
          : "") +
        `\n配置的图片模型：${models.image}；视频模型：${models.video}；音频模型：${models.audio}；文本执行模型：${models.text}；默认数量：${context?.params?.count || 1}；默认尺寸：${context?.params?.size || "自动"}。`,
    },
    ...request.turns,
  ];
  let snapshot: TextSnapshot = { content: "", reasoning: "" };
  const calls: ToolCall[] = [];
  let validatedPlan = false;
  const result = await agentExecutor.execute(
    {
      userInstruction: prompt,
      rawInput: prompt,
      finalPrompt: prompt,
      model: {
        id: request.model?.modelId || "",
        type: "text",
        isExplicit: true,
      },
      defaultModels: models,
      defaultModelRefs: {
        ...(refs.image ? { image: refs.image } : {}),
        ...(refs.video ? { video: refs.video } : {}),
      },
      params: context?.params || { count: 1 },
      selection,
    },
    {
      modelRef: request.model,
      signal,
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
      onToolCall: (call) => calls.push(call),
      complete: async () => {
        const raw = await (request.codex ? requestCodexDiscussion : requestTextChat)({
          ...request,
          turns: turns.map((turn, index) =>
            index === turns.length - 1
              ? {
                  ...turn,
                  content:
                    turn.content +
                    userContext +
                    (knowledge ? `\n${knowledge}` : ""),
                  images: canvasImages,
                }
              : turn,
          ),
          onUpdate: (value) => {
            snapshot = { ...value, content: discussionProse(value.content) };
            request.onUpdate(snapshot);
          },
        });
        if (
          raw.finishReason &&
          !["stop", "end_turn", "STOP", "stop_sequence"].includes(
            raw.finishReason,
          )
        )
          throw new Error("回复未完整结束，未执行生成工具，请重试讨论。");
        // The legacy parser heals partial JSON; discussion must not execute healed partial calls.
        const clean = raw.content
          .trim()
          .replace(/^```(?:json)?\s*/, "")
          .replace(/\s*```$/, "");
        if (clean.startsWith("{")) {
          const plan = JSON.parse(clean);
          if (
            typeof plan.content !== "string" ||
            !Array.isArray(plan.next) ||
            plan.next.some(
              (step: any) =>
                !step ||
                typeof step.mcp !== "string" ||
                !step.args ||
                typeof step.args !== "object" ||
                Array.isArray(step.args),
            )
          )
            throw new Error("生成计划格式无效，本次未提交任务。");
          // Validate the exact plan before the legacy parser can repair/normalize it.
          validateDiscussionTools(
            plan.next.map((step: any) => ({
              name: step.mcp,
              arguments: step.args,
            })),
          );
          validatedPlan = true;
        } else if (parseToolCalls(clean).length) {
          throw new Error("生成计划不是完整 JSON，本次未提交任务。");
        }
        snapshot = { ...raw, content: discussionProse(raw.content) };
        return raw.content;
      },
    },
  );
  signal.throwIfAborted();
  if (!result.success)
    throw new Error(
      `文本规划未完成，尚未提交生成任务。${result.error || "请稍后手动重试或切换文本模型。"}`,
    );
  snapshot.content =
    extractTextContent(result.response || "") || snapshot.content;
  if (calls.length && !validatedPlan) throw new Error("生成计划未完整确认。");
  validateDiscussionTools(calls);
  const steps = calls.map((call) => {
    const kind = call.name.slice("generate_".length) as DiscussionTarget;
    if (context?.targetType && kind !== context.targetType)
      throw new Error("计划类型与当前执行模型不符，请重新讨论。");
    const a = call.arguments;
    const references =
      (a.referenceImages as string[] | undefined) || knownImages;
    if (
      references.length > 6 ||
      references.some((url) => !knownImages.includes(url))
    )
      throw new Error("生成工具引用了未提供的图片，请先选择或上传参考图。");
    if (!models[kind] || !refs[kind])
      throw new Error(`请先配置${discussionTargetLabels[kind]}模型。`);
    return {
      type: kind,
      prompt: a.prompt as string,
      count: (a.count ?? 1) as number,
      model: models[kind],
      modelRef: refs[kind],
      referenceImages: references,
      ...(a.size || context?.params?.size
        ? { size: (a.size || context?.params?.size) as string | number }
        : {}),
      ...(a.seconds || a.duration || context?.params?.duration
        ? {
            seconds: (a.seconds || a.duration || context?.params?.duration) as
              | string
              | number,
          }
        : {}),
      ...(context?.targetType === kind && context.executionParams
        ? { params: context.executionParams }
        : {}),
    };
  });
  if (steps.length) {
    const plan: DiscussionPlan = { version: 1, status: "ready", steps };
    validateDiscussionPlan(plan);
    await request.onPlan(plan);
  }
  request.onUpdate(snapshot);
  return snapshot;
}

/** Confirmation executes the saved, application-owned route without another planning request. */
export async function executeDiscussionPlan(
  request: Pick<
    DiscussionRequest,
    "sessionId" | "messageId" | "link" | "signal" | "onTasks" | "onBeforeSubmit"
  >,
  plan: DiscussionPlan,
): Promise<void> {
  validateDiscussionPlan(plan);
  if (plan.status !== "ready") throw new Error("该计划已经提交或取消。");
  const { signal } = request;
  signal.throwIfAborted();
  const tools = {
    image: imageGenerationTool,
    video: videoGenerationTool,
    audio: audioGenerationTool,
    text: textGenerationTool,
  };
  // Validate every route and provider-specific action before submitting any task.
  const prepared = plan.steps.map((step) => {
    // Recheck saved ready plans from older versions, before any queue submission.
    if (step.type === "image") validateDiscussionImagePrompt(step.prompt);
    const route = resolveInvocationRoute(step.type, step.modelRef);
    if (!route.apiKey)
      throw new Error(`请先配置${discussionTargetLabels[step.type]}模型。`);
    let params: Record<string, unknown> | undefined = step.params;
    if (
      step.type === "audio" &&
      (isSunoNativeModel(step.model) || isSunoV2Model(step.model))
    ) {
      const routePlan = resolveInvocationPlanFromRoute("audio", step.modelRef);
      if (!routePlan) throw new Error("当前音频模型缺少可用接口。");
      const controls = { ...step.params };
      // Each planned prompt must survive prior free-text entries in the parameter panel.
      for (const key of ['prompt', 'gpt_description_prompt', 'sound', 'content']) delete controls[key];
      params = isSunoNativeModel(step.model)
        ? buildSunoNativeInputParams(
            step.model,
            controls,
            step.prompt,
            routePlan.provider.profileId,
            collectSunoNativeResources(taskQueueService.getAllTasks()),
          )
        : buildSunoV2InputParams(
            step.model,
            controls,
            step.prompt,
            routePlan.provider.profileId,
            collectSunoV2Resources(
              taskQueueService.getAllTasks(),
              routePlan.provider.profileId,
            ),
          );
    }
    return { step, params };
  });
  const { reserveDiscussionCanvas } = await import("./discussion-canvas");
  const canvas = reserveDiscussionCanvas(plan, request.link.boardId, request.link.runId);
  const taskIds: string[] = [];
  const total = plan.steps.reduce((n, s) => n + s.count, 0);
  try {
    await request.onBeforeSubmit();
    let index = 0;
    for (const { step, params } of prepared) {
      // One task per item also supports audio/text tools whose queue count is capped at one.
      for (let i = 0; i < step.count; i++) {
        signal.throwIfAborted();
        canvas.assertCurrent();
        const args = {
          prompt: step.prompt,
          count: 1,
          model: step.model,
          modelRef: step.modelRef,
          referenceImages: step.referenceImages,
          size: step.size,
          seconds: step.seconds,
          params,
          anchorId: canvas.ids[index],
          workflowId: request.link.runId,
          batchId: request.link.runId,
          batchIndex: ++index,
          batchTotal: total,
          globalIndex: index,
          autoInsertToCanvas: step.type !== "text",
          conversationLink: {
            sessionId: request.sessionId!,
            messageId: request.messageId,
            runId: request.link.runId,
            boardId: request.link.boardId,
          },
        };
        const queued = await tools[step.type].execute(args, {
          mode: "queue",
          signal,
        });
        if (!queued.success) throw new Error(queued.error || "提交生成失败");
        const ids = (queued.data as { taskIds?: string[] })?.taskIds || [];
        if (!ids.length)
          throw new Error("生成队列没有返回任务编号，请检查任务列表。");
        canvas.bind(index - 1, ids);
        taskIds.push(...ids);
        await request.onTasks([...taskIds]);
      }
    }
    await waitForDiscussionTasks(taskIds, signal);
  } catch (error) {
    if (signal.aborted)
      for (const id of taskIds) {
        const task = taskQueueService.getTask(id);
        if (
          task &&
          [TaskStatus.PENDING, TaskStatus.PROCESSING].includes(task.status)
        )
          taskQueueService.cancelTask(id);
      }
    throw error;
  } finally {
    canvas.finish();
  }
}
