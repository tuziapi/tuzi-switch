import type { LayerRecoveryHandle } from '../../services/layer-decomposition/recovery';
import { decomposeWithConfiguredImageProvider } from '../../services/layer-decomposition/provider';
import { SEEDREAM55_MODEL_ID } from '../../services/model-adapters/seedream55';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, MessagePlugin, Progress } from 'tdesign-react';
import { Layers3, X } from 'lucide-react';
import type { PlaitBoard } from '@plait/core';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { RetryImage } from '../retry-image';
import { useDrawnix } from '../../hooks/use-drawnix';
import {
  createLayerDecompositionApiClient,
  insertLayerDecomposition,
  LayerDecompositionCorrectionRequiredError,
  type LayerBoundingBoxTuple,
  type LayerDecompositionMode,
  type LayerDecompositionProgress,
  type LayerDecompositionResponse,
} from '../../services/layer-decomposition';
import './layer-decomposition-dialog.scss';

interface LayerDecompositionDialogProps {
  open: boolean;
  board: PlaitBoard;
  sourceElementId: string;
  imageUrl: string;
  language: 'zh' | 'en';
  automatic?: boolean;
  providerModelId?: string;
  providerProfileId?: string;
  onClose: () => void;
}

const PHASE_LABELS: Record<string, { zh: string; en: string }> = {
  recovering: { zh: '获取已有结果', en: 'Recovering existing result' },
  queued: { zh: '等待处理', en: 'Queued' },
  recognizing: { zh: '识别对象', en: 'Recognizing' },
  extracting: { zh: '提取图层', en: 'Extracting' },
  inpainting: { zh: '补全背景', en: 'Rebuilding background' },
  quality_check: { zh: '校验画面', en: 'Validating' },
  validating: { zh: '校验画面', en: 'Validating' },
  correcting: { zh: '等待修正', en: 'Correction needed' },
  completed: { zh: '处理完成', en: 'Completed' },
  applying: { zh: '写入画布', en: 'Applying to canvas' },
};

const MODES: Array<{
  value: LayerDecompositionMode;
  zh: string;
  en: string;
}> = [
  { value: 'auto', zh: '自动识别', en: 'Automatic' },
  { value: 'prompt', zh: '描述指定', en: 'By description' },
  { value: 'bbox', zh: '框选区域', en: 'By bounding box' },
];

const CORRECTION_ACTIONS = [
  { value: 'add' as const, zh: '新增', en: 'Add' },
  { value: 'remove' as const, zh: '移除', en: 'Remove' },
  { value: 'replace' as const, zh: '替换', en: 'Replace' },
];

function parseBoundingBox(
  values: readonly string[],
  errorMessage: string
): LayerBoundingBoxTuple {
  const coordinates = values.map((value) => Number(value));
  if (
    coordinates.length !== 4 ||
    coordinates.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1000
    ) ||
    coordinates[2] <= coordinates[0] ||
    coordinates[3] <= coordinates[1]
  ) {
    throw new Error(errorMessage);
  }
  return coordinates as LayerBoundingBoxTuple;
}

function recognizedText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  return Array.isArray(record.lines) ? record.lines.map(recognizedText).filter(Boolean).join('\n') : '';
}

export const LayerDecompositionDialog: React.FC<
  LayerDecompositionDialogProps
> = ({
  open,
  board,
  sourceElementId,
  imageUrl,
  language,
  automatic = false,
  providerModelId,
  providerProfileId,
  onClose,
}) => {
  const { board: activeBoard } = useDrawnix();
  const [mode, setMode] = useState<LayerDecompositionMode>('auto');
  const [prompt, setPrompt] = useState('');
  const [bbox, setBbox] = useState(['0', '0', '1000', '1000']);
  const seedream55 = providerModelId === SEEDREAM55_MODEL_ID;
  const [maxLayers, setMaxLayers] = useState(seedream55 ? 29 : 16);
  const [textRecognition, setTextRecognition] = useState(false);
  const [layerSize, setLayerSize] = useState<'auto' | '1K' | '1.5K' | '2K'>(
    'auto'
  );
  const [recovery, setRecovery] = useState<LayerRecoveryHandle>();
  const [processing, setProcessing] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('queued');
  const [result, setResult] = useState<LayerDecompositionResponse | null>(null);
  const [needsCorrection, setNeedsCorrection] = useState(false);
  const [correctionPrompt, setCorrectionPrompt] = useState('');
  const [correctionAction, setCorrectionAction] = useState<
    'add' | 'remove' | 'replace'
  >('replace');
  const [correctionLayer, setCorrectionLayer] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const taskIdRef = useRef<string | null>(null);
  const autoStartedRef = useRef(false);
  const activeBoardRef = useRef(activeBoard);
  const isZh = language === 'zh';

  useEffect(() => {
    activeBoardRef.current = activeBoard;
  }, [activeBoard]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      taskIdRef.current = null;
      setProcessing(false);
      setTaskError(null);
      setProgress(0);
      setPhase('queued');
      setResult(null);
      setRecovery(undefined);
      setNeedsCorrection(false);
      setCorrectionPrompt('');
      autoStartedRef.current = false;
    }
    return () => abortRef.current?.abort();
  }, [open]);

  const ensureSourceIsActive = useCallback(() => {
    if (activeBoardRef.current !== board) {
      throw new Error(
        isZh
          ? '画板已切换，请重新选择图片'
          : 'Board changed; select the image again'
      );
    }
    if (!board.children.some((element) => element.id === sourceElementId && element.url === imageUrl)) {
      throw new Error(
        isZh ? '源图片已不存在' : 'Source image no longer exists'
      );
    }
  }, [board, isZh, sourceElementId, imageUrl]);

  const handleProgress = useCallback((item: LayerDecompositionProgress) => {
    taskIdRef.current = item.taskId;
    setProgress(item.progress);
    setPhase(item.phase || item.status);
  }, []);

  const cancel = useCallback(async () => {
    const taskId = taskIdRef.current;
    abortRef.current?.abort();
    if (!seedream55 && taskId && taskId !== 'provider' && processing) {
      try {
        await createLayerDecompositionApiClient().cancel(taskId);
      } catch {
        // 本地取消立即生效；服务端任务可能已自然结束。
      }
    }
    close();
  }, [close, processing, seedream55]);

  const buildPrompt = useCallback((): string | undefined => {
    if (mode === 'auto') return undefined;
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      throw new Error(
        isZh ? '请填写需要识别的对象' : 'Describe the target object'
      );
    }
    if (mode === 'prompt') return normalizedPrompt;
    const region = parseBoundingBox(
      bbox,
      isZh
        ? '区域坐标需为 0-1000 内的有效矩形'
        : 'Bounding box must be a valid rectangle within 0-1000'
    );
    return `${normalizedPrompt}\n<bbox>${region.join(' ')}</bbox>`;
  }, [bbox, isZh, mode, prompt]);

  const runTask = useCallback(
    async (
      operation: (
        client: ReturnType<typeof createLayerDecompositionApiClient>,
        signal: AbortSignal
      ) => Promise<LayerDecompositionResponse>
    ) => {
      if (processing || runningRef.current) return;
      try {
        ensureSourceIsActive();
      } catch (error) {
        MessagePlugin.warning(
          error instanceof Error ? error.message : String(error)
        );
        close();
        return;
      }

      const controller = new AbortController();
      runningRef.current = true;
      abortRef.current = controller;
      setProcessing(true);
      setTaskError(null);
      setProgress(0);
      setPhase('queued');
      try {
        const response = await operation(
          createLayerDecompositionApiClient(),
          controller.signal
        );
        controller.signal.throwIfAborted();
        ensureSourceIsActive();
        if (response.resultKind === 'test') {
          MessagePlugin.warning(
            isZh
              ? '当前为测试后端，未接入真实 AI 分层模型；源图片未修改'
              : 'The test backend has no real AI layer model; the source image is unchanged'
          );
          if (automatic) close();
          return;
        }
        setResult(response);
        setNeedsCorrection(false);
        setProgress(100);
        if (automatic) {
          setPhase('applying');
          ensureSourceIsActive();
          await insertLayerDecomposition(board, sourceElementId, response, {
            signal: controller.signal,
            boardGuard: () =>
              activeBoardRef.current === board &&
              board.children.some((element) => element.id === sourceElementId && element.url === imageUrl),
          });
          MessagePlugin.success(
            isZh
              ? `已生成 ${response.layers.length + 1} 个可编辑图层`
              : `Created ${response.layers.length + 1} editable layers`
          );
          close();
        } else {
          setPhase('completed');
        }
      } catch (error) {
        if (error instanceof LayerDecompositionCorrectionRequiredError) {
          if (automatic) {
            MessagePlugin.warning(
              isZh
                ? '分层质量未通过，源图片保持不变'
                : 'Layer quality check failed; the source image is unchanged'
            );
            close();
            return;
          }
          taskIdRef.current = error.taskId;
          setNeedsCorrection(true);
          setPhase('correcting');
          return;
        }
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }
        const message = error instanceof Error
          ? error.message
          : isZh ? '图片分层失败' : 'Layer decomposition failed';
        setTaskError(message);
        MessagePlugin.error(message);
        if (automatic) close();
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        runningRef.current = false;
        setProcessing(false);
      }
    },
    [
      automatic,
      board,
      close,
      ensureSourceIsActive,
      isZh,
      processing,
      sourceElementId,
    ]
  );

  const submit = useCallback(async () => {
    let targetPrompt: string | undefined;
    try {
      targetPrompt = buildPrompt();
    } catch (error) {
      MessagePlugin.warning(
        error instanceof Error ? error.message : String(error)
      );
      return;
    }
    taskIdRef.current = null;
    await runTask(async (client, signal) => {
      const request = {
        image: imageUrl,
        ...(targetPrompt ? { prompt: targetPrompt } : {}),
        mode: mode === 'auto' ? ('auto' as const) : ('prompt' as const),
        maxLayers,
        ...(seedream55 ? { size: layerSize, textRecognition } : {}),
      };
      if (seedream55) {
        if (recovery) return recovery.recover({ signal, onProgress: handleProgress });
        const response = await decomposeWithConfiguredImageProvider(request, {
          modelId: SEEDREAM55_MODEL_ID,
          profileId: providerProfileId,
          onRecoveryAvailable: setRecovery,
          signal,
          onProgress: handleProgress,
        });
        if (!response)
          throw new Error('请先配置可调用 Seedream 5.5 的图片服务');
        return response;
      }
      return client.decompose(request, {
        signal,
        onProgress: handleProgress,
      });
    });
  }, [
    buildPrompt,
    handleProgress,
    imageUrl,
    maxLayers,
    mode,
    runTask,
    seedream55,
    providerProfileId,
    recovery,
    layerSize,
    textRecognition,
  ]);

  useEffect(() => {
    if (!open || !automatic || autoStartedRef.current) return;
    const timer = window.setTimeout(() => {
      if (autoStartedRef.current) return;
      autoStartedRef.current = true;
      void submit();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [automatic, open, submit]);

  const correct = useCallback(async () => {
    const taskId = taskIdRef.current;
    const normalizedPrompt = correctionPrompt.trim();
    if (!taskId || !normalizedPrompt) {
      MessagePlugin.warning(
        isZh ? '请填写修正说明' : 'Describe the correction'
      );
      return;
    }
    let correctionBox: LayerBoundingBoxTuple | undefined;
    if (mode === 'bbox') {
      try {
        correctionBox = parseBoundingBox(
          bbox,
          isZh ? '请检查修正区域坐标' : 'Check the correction bounding box'
        );
      } catch (error) {
        MessagePlugin.warning(
          error instanceof Error ? error.message : String(error)
        );
        return;
      }
    }
    const layerZIndex = correctionLayer.trim()
      ? Number(correctionLayer)
      : undefined;
    if (
      layerZIndex !== undefined &&
      (!Number.isInteger(layerZIndex) || layerZIndex < 1 || layerZIndex > 16)
    ) {
      MessagePlugin.warning(
        isZh ? '图层序号需为 1-16 的整数' : 'Layer index must be 1-16'
      );
      return;
    }
    await runTask((client, signal) =>
      client.correct(
        taskId,
        {
          prompt: normalizedPrompt,
          action: correctionAction,
          ...(layerZIndex === undefined ? {} : { layerZIndex }),
          ...(correctionBox ? { boundingBox: correctionBox } : {}),
        },
        { signal, onProgress: handleProgress }
      )
    );
  }, [
    bbox,
    correctionAction,
    correctionLayer,
    correctionPrompt,
    handleProgress,
    isZh,
    mode,
    runTask,
  ]);

  const applyResult = useCallback(async () => {
    if (!result || processing) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setProcessing(true);
    setPhase('applying');
    try {
      ensureSourceIsActive();
      await insertLayerDecomposition(board, sourceElementId, result, {
        signal: controller.signal,
        boardGuard: () =>
          activeBoardRef.current === board &&
          board.children.some((element) => element.id === sourceElementId && element.url === imageUrl),
      });
      MessagePlugin.success(
        isZh
          ? `已生成 ${result.layers.length + 1} 个可编辑图层`
          : `Created ${result.layers.length + 1} editable layers`
      );
      onClose();
    } catch (error) {
      if (!controller.signal.aborted) {
        MessagePlugin.error(
          error instanceof Error ? error.message : String(error)
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setProcessing(false);
    }
  }, [
    board,
    ensureSourceIsActive,
    isZh,
    onClose,
    processing,
    result,
    sourceElementId,
  ]);

  const phaseLabel = PHASE_LABELS[phase]?.[language] || phase;
  const primaryAction = result
    ? applyResult
    : needsCorrection
      ? correct
      : submit;
  const primaryLabel = result
    ? isZh
      ? '应用到画布'
      : 'Apply to canvas'
    : needsCorrection
      ? isZh
        ? '提交修正'
        : 'Submit correction'
      : recovery
        ? isZh ? '获取已有结果' : 'Get existing result'
        : isZh ? '开始分层' : 'Create layers';

  return (
    <ConfirmDialog
      open={open}
      title={
        <span className="layer-decomposition-dialog__title">
          <Layers3 size={18} />
          {isZh ? 'AI 图片分层' : 'AI Image Layers'}
        </span>
      }
      className="layer-decomposition-dialog"
      closeOnConfirm={false}
      closeOnCancel={false}
      confirmDisabled={processing}
      onConfirm={primaryAction}
      onCancel={processing ? cancel : close}
      onOpenChange={(nextOpen) =>
        !nextOpen && (processing ? cancel() : close())
      }
      footer={
        automatic ? (
          <div className="layer-decomposition-dialog__footer">
            <Button
              variant="outline"
              icon={processing ? <X size={15} /> : undefined}
              onClick={processing ? cancel : close}
            >
              {processing
                ? isZh
                  ? seedream55 ? '取消等待' : '取消任务'
                  : seedream55 ? 'Cancel waiting' : 'Cancel task'
                : isZh
                  ? '取消'
                  : 'Cancel'}
            </Button>
          </div>
        ) : (
          <div className="layer-decomposition-dialog__footer">
            <Button
              variant="outline"
              icon={processing ? <X size={15} /> : undefined}
              onClick={processing ? cancel : close}
            >
              {processing
                ? isZh
                  ? seedream55 ? '取消等待' : '取消任务'
                  : seedream55 ? 'Cancel waiting' : 'Cancel task'
                : isZh
                  ? '取消'
                  : 'Cancel'}
            </Button>
            <Button
              theme="primary"
              loading={processing}
              onClick={primaryAction}
            >
              {processing ? phaseLabel : primaryLabel}
            </Button>
          </div>
        )
      }
    >
      <div className="layer-decomposition-dialog__body">
        {recovery && <p style={{ overflowWrap: 'anywhere' }}>
          {isZh ? `请求 ID：${recovery.requestId}。获取已有结果不会再次生图。` : `Request ID: ${recovery.requestId}. Recovery does not generate again.`}
        </p>}
        {taskError && (
          <div role="alert" className="layer-decomposition-dialog__error">
            <strong>{isZh ? '分层未完成' : 'Layer decomposition did not complete'}</strong>
            <div>{taskError}</div>
            <div>{isZh ? '未自动重试。再次提交前请先核对调用记录，避免重复计费。' : 'No automatic retry was made. Check the request record before submitting again to avoid duplicate charges.'}</div>
          </div>
        )}
        <RetryImage
          src={imageUrl}
          alt={isZh ? '待分层原图' : 'Source image for layers'}
          className="layer-decomposition-dialog__preview"
          eager
          preferCachedBlob
          showSkeleton={false}
          maxRetries={2}
          loadTimeoutMs={20000}
          fallback={
            <div role="status" className="layer-decomposition-dialog__preview">
              {isZh ? '原图预览暂不可用' : 'Source preview is unavailable'}
            </div>
          }
        />

        {!automatic && !result && !needsCorrection && (
          <>
            <div
              className="layer-decomposition-dialog__modes"
              role="group"
              aria-label={isZh ? '分层方式' : 'Layer mode'}
            >
              {MODES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={mode === item.value}
                  disabled={processing || Boolean(recovery)}
                  onClick={() => setMode(item.value)}
                >
                  {item[language]}
                </button>
              ))}
            </div>
            {mode !== 'auto' && (
              <label className="layer-decomposition-dialog__field">
                <span>{isZh ? '指定对象' : 'Target object'}</span>
                <textarea
                  value={prompt}
                  maxLength={4000}
                  disabled={processing || Boolean(recovery)}
                  placeholder={
                    isZh
                      ? '例如：人物、标题文字和前景装饰'
                      : 'e.g. person, title text, foreground decoration'
                  }
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
            )}
          </>
        )}

        {!automatic && !result && mode === 'bbox' && (
          <div className="layer-decomposition-dialog__bbox">
            {['x1', 'y1', 'x2', 'y2'].map((label, index) => (
              <label key={label}>
                <span>{label}</span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={bbox[index]}
                  disabled={processing || Boolean(recovery)}
                  onChange={(event) =>
                    setBbox((current) =>
                      current.map((value, itemIndex) =>
                        itemIndex === index ? event.target.value : value
                      )
                    )
                  }
                />
              </label>
            ))}
          </div>
        )}

        {!automatic && !result && !needsCorrection && (
          <label className="layer-decomposition-dialog__field layer-decomposition-dialog__layer-count">
            <span>{isZh ? '最多前景图层' : 'Maximum foreground layers'}</span>
            <output>{maxLayers}</output>
            <input
              type="range"
              min={1}
              max={seedream55 ? 99 : 16}
              step={1}
              value={maxLayers}
              disabled={processing || Boolean(recovery)}
              onChange={(event) => setMaxLayers(Number(event.target.value))}
            />
          </label>
        )}

        {seedream55 && !result && (
          <div className="layer-decomposition-dialog__field">
            <label>
              {isZh ? '分层尺寸' : 'Layer size'}
              <select
                aria-label={isZh ? '分层尺寸' : 'Layer size'}
                value={layerSize}
                disabled={processing || Boolean(recovery)}
                onChange={(event) =>
                  setLayerSize(event.target.value as typeof layerSize)
                }
              >
                {['auto', '1K', '1.5K', '2K'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={textRecognition}
                disabled={processing || Boolean(recovery)}
                onChange={(event) => setTextRecognition(event.target.checked)}
              />
              {isZh ? '识别图层文字（OCR）' : 'Recognize layer text (OCR)'}
            </label>
            <span>
              {isZh
                ? `最多返回 ${maxLayers + 1} 张图片（含底图），按服务商规则计费`
                : `Up to ${maxLayers + 1} images including the base; provider pricing applies`}
            </span>
          </div>
        )}
        {!automatic && needsCorrection && !result && (
          <div className="layer-decomposition-dialog__correction">
            <strong>
              {isZh
                ? '质量校验未通过，请修正分层'
                : 'Quality check needs a correction'}
            </strong>
            <div
              className="layer-decomposition-dialog__modes"
              role="group"
              aria-label={isZh ? '修正操作' : 'Correction action'}
            >
              {CORRECTION_ACTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={correctionAction === item.value}
                  disabled={processing || Boolean(recovery)}
                  onClick={() => setCorrectionAction(item.value)}
                >
                  {item[language]}
                </button>
              ))}
            </div>
            <label className="layer-decomposition-dialog__field">
              <span>{isZh ? '修正说明' : 'Correction description'}</span>
              <textarea
                value={correctionPrompt}
                maxLength={4000}
                disabled={processing || Boolean(recovery)}
                placeholder={
                  isZh
                    ? '例如：补回人物帽子边缘，并移除背景残影'
                    : 'e.g. restore the hat edge and remove the background halo'
                }
                onChange={(event) => setCorrectionPrompt(event.target.value)}
              />
            </label>
            <label className="layer-decomposition-dialog__field">
              <span>
                {isZh
                  ? '目标图层序号（可选）'
                  : 'Target layer index (optional)'}
              </span>
              <input
                type="number"
                min={1}
                max={16}
                step={1}
                value={correctionLayer}
                disabled={processing || Boolean(recovery)}
                onChange={(event) => setCorrectionLayer(event.target.value)}
              />
            </label>
          </div>
        )}

        {!automatic && result && (
          <div
            className="layer-decomposition-dialog__quality"
            aria-live="polite"
          >
            <strong>{isZh ? '分层已就绪' : 'Layers are ready'}</strong>
            <span>
              {isZh ? '图层数量' : 'Layers'}: {result.layers.length + 1}
            </span>
            {!seedream55 && <><span>SSIM: {result.quality?.ssim?.toFixed(4) ?? '-'}</span>
            <span>
              {isZh ? '通道误差' : 'Channel error'}:{' '}
              {result.quality?.channelErrorRate === undefined
                ? '-'
                : `${(result.quality.channelErrorRate * 100).toFixed(3)}%`}
            </span></>}
          </div>
        )}

        {seedream55 && result && (
          <div className="layer-decomposition-dialog__field">
            <span>
              {isZh
                ? '请检查分层效果后再应用到画布'
                : 'Review the layers before applying them to the canvas'}
            </span>
            {[result.background, ...result.layers]
              .filter((layer) => layer.textRecognition !== undefined)
              .map((layer) => (
                <details key={layer.zIndex}>
                  <summary>{layer.name} · OCR</summary>
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {recognizedText(layer.textRecognition) || (isZh ? '文字结构已保存，可导出图层清单查看' : 'Text structure saved; export the layer manifest to inspect it')}
                  </pre>
                </details>
              ))}
            <span>
              {isZh
                ? 'OCR 和图层扩展信息将随画布及图层清单保存'
                : 'OCR and layer metadata are saved with the canvas and manifest'}
            </span>
          </div>
        )}
        {processing && (
          <div
            className="layer-decomposition-dialog__progress"
            aria-live="polite"
          >
            <div>
              <span>{phaseLabel}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress percentage={Math.round(progress)} label={false} />
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
};

export default LayerDecompositionDialog;
