import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Upload, LoaderCircle } from "lucide-react";
import type { CreativeAccountBridge } from "./bridge-types";
import {
  videoCompression,
  type CompressionOptions,
} from "./video-compression-store";

const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function VideoCompressionPanel({
  bridge,
}: {
  bridge?: CreativeAccountBridge;
}) {
  const state = useSyncExternalStore(
    videoCompression.subscribe,
    videoCompression.getSnapshot,
  );
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [quality, setQuality] =
    useState<CompressionOptions["quality"]>("balanced");
  const [resolution, setResolution] =
    useState<CompressionOptions["resolution"]>("original");
  const [keepAudio, setKeepAudio] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const record =
    state.records.find((item) => item.id === selectedId) ||
    (file ? undefined : state.records[0]);
  const inputUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : ""),
    [file],
  );
  const outputUrl = useMemo(
    () => (record?.video ? URL.createObjectURL(record.video) : ""),
    [record?.video],
  );
  useEffect(() => {
    void videoCompression.load();
  }, []);
  useEffect(
    () => () => {
      if (inputUrl) URL.revokeObjectURL(inputUrl);
    },
    [inputUrl],
  );
  useEffect(
    () => () => {
      if (outputUrl) URL.revokeObjectURL(outputUrl);
    },
    [outputUrl],
  );
  const busy = Boolean(state.activeId);
  const active = state.records.find((item) => item.id === state.activeId);
  const progress = active
    ? Math.min(99, Math.floor((state.seconds / active.duration) * 100))
    : 0;
  const save = async () => {
    if (!record?.video) return;
    try {
      const name = `${record.name.replace(/\.[^.]+$/, "")}-compressed.mp4`;
      if (!bridge?.saveMedia) throw new Error("请使用桌面版保存视频。");
      await bridge.saveMedia(record.video, name, "video");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "视频导出失败。");
    }
  };
  return (
    <>
      <main className="ecommerce-workbench__main">
        <div className="ecommerce-workbench__heading">
          <h1>视频压缩</h1>
          <p>在本机减小视频体积，保留原文件，无需模型或 API Key。</p>
        </div>
        <div className="ecommerce-compression-previews">
          <section>
            <h2>原视频{file ? ` · ${formatBytes(file.size)}` : ""}</h2>
            {inputUrl ? (
              <video
                key={inputUrl}
                src={inputUrl}
                controls
                preload="metadata"
                onLoadedMetadata={(event) => {
                  const seconds = event.currentTarget.duration;
                  if (Number.isFinite(seconds) && seconds > 0)
                    setDuration(seconds);
                  else setError("无法读取视频时长，请选择完整文件。");
                }}
                onError={() => {
                  setDuration(0);
                  setError(
                    "无法播放此视频，请转换为 MP4、MOV 或 WebM 后重试。",
                  );
                }}
              />
            ) : (
              <div className="ecommerce-compression-empty">
                上传视频即可预览
              </div>
            )}
          </section>
          <section>
            <h2>
              压缩结果
              {record?.video ? ` · ${formatBytes(record.video.size)}` : ""}
            </h2>
            {outputUrl ? (
              <video
                key={outputUrl}
                src={outputUrl}
                controls
                preload="metadata"
              />
            ) : (
              <div className="ecommerce-compression-empty">
                {busy ? `正在本机压缩 ${progress}%` : "压缩完成后在这里对比"}
              </div>
            )}
          </section>
        </div>
        {record && (
          <section
            className="ecommerce-plan ecommerce-video-record"
            aria-label="压缩记录"
          >
            <label>
              压缩记录
              <select
                aria-label="压缩记录"
                value={record.id}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {state.records.map((item) => (
                  <option key={item.id} value={item.id}>
                    {new Date(item.createdAt).toLocaleString()} · {item.name} ·{" "}
                    {item.status === "complete"
                      ? "已保存"
                      : item.status === "running"
                        ? "压缩中"
                        : "未完成"}
                  </option>
                ))}
              </select>
            </label>
            {record.video && (
              <>
                <p>
                  {formatBytes(record.originalBytes)} →{" "}
                  {formatBytes(record.video.size)} ·{" "}
                  {record.video.size < record.originalBytes
                    ? `体积减少 ${(100 - (record.video.size / record.originalBytes) * 100).toFixed(1)}%`
                    : "原视频已较小，本次转码未减少体积，可保留原文件或试用更小体积档位。"}
                </p>
                <button type="button" onClick={() => void save()}>
                  保存压缩视频
                </button>
              </>
            )}
            {record.error && <p role="status">{record.error}</p>}
          </section>
        )}
      </main>
      <aside className="ecommerce-workbench__panel">
        <label className="ecommerce-upload">
          <input
            aria-label="选择压缩视频"
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            disabled={busy}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              setError("");
              setSelectedId("");
              setDuration(0);
              if (!selected) {
                setFile(null);
                return;
              }
              if (!selected.size || selected.size > 128 * 1024 * 1024) {
                setFile(null);
                setError("请选择 128 MB 以内的视频。");
                return;
              }
              setFile(selected);
            }}
          />
          <Upload size={18} />
          <span>{file ? file.name : "上传待压缩视频"}</span>
          <small>MP4、MOV、WebM，最多 128 MB</small>
        </label>
        <label className="ecommerce-model-field">
          压缩方式
          <select
            aria-label="压缩方式"
            value={quality}
            disabled={busy}
            onChange={(event) =>
              setQuality(event.target.value as CompressionOptions["quality"])
            }
          >
            <option value="balanced">均衡 · 推荐</option>
            <option value="small">更小体积</option>
            <option value="high">更高画质</option>
          </select>
          <small>压缩效果取决于原视频；不裁剪内容，可能轻微损失画质。</small>
        </label>
        <label className="ecommerce-model-field">
          输出尺寸
          <select
            aria-label="压缩输出尺寸"
            value={resolution}
            disabled={busy}
            onChange={(event) =>
              setResolution(
                event.target.value as CompressionOptions["resolution"],
              )
            }
          >
            <option value="original">保留尺寸（最高 4K）</option>
            <option value="1080p">最高 1080p</option>
            <option value="720p">最高 720p</option>
          </select>
          <small>保持画面比例，小视频不会放大。</small>
        </label>
        <label className="ecommerce-compression-audio">
          <input
            type="checkbox"
            checked={keepAudio}
            disabled={busy}
            onChange={(event) => setKeepAudio(event.target.checked)}
          />
          保留原音频
        </label>
        <p className="ecommerce-model-status">
          本地处理 · 不上传 · 不消耗模型额度
        </p>
        {!bridge?.compressVideo && (
          <p role="status">请在带有压缩引擎的桌面测试版中使用。</p>
        )}
        {(error || state.storageError) && (
          <p className="ecommerce-error" role="alert">
            {error || state.storageError}
          </p>
        )}
        <button
          className="ecommerce-generate"
          disabled={
            busy || !state.ready || !bridge?.compressVideo || !file || !duration
          }
          onClick={() => {
            if (!file || !bridge?.compressVideo) return;
            setError("");
            void videoCompression
              .start(
                file,
                duration,
                { quality, resolution, keepAudio },
                bridge.compressVideo,
              )
              .then(setSelectedId)
              .catch((cause) => setError(cause.message));
          }}
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={17} />
              正在压缩 {progress}%
            </>
          ) : (
            "开始压缩"
          )}
        </button>
        {busy && (
          <>
            <progress aria-label="压缩进度" value={progress} max={100} />
            <button
              className="ecommerce-stop"
              onClick={() => videoCompression.cancel()}
            >
              取消压缩
            </button>
          </>
        )}
      </aside>
    </>
  );
}
