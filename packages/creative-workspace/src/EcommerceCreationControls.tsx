import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Minus, Upload, X } from "lucide-react";
import type { ParamConfig } from "../upstream/packages/drawnix/src/constants/model-config";

export function OutputCounter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="ec-counter" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`${label}减少`}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={12} />
      </button>
      <output aria-label={label}>{value}</output>
      <button
        type="button"
        aria-label={`${label}增加`}
        disabled={value >= 4}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

export function ReferenceUpload({
  files,
  onChange,
  kind,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  kind: "viral" | "style" | "person";
}) {
  const required = kind === "viral";
  const title = required
    ? "爆款参考图"
    : kind === "person"
      ? "人物 / 姿势参考"
      : "风格参考图";
  const [expanded, setExpanded] = useState(required || files.length > 0);
  const urls = useMemo(
    () => files.map((file) => URL.createObjectURL(file)),
    [files],
  );
  useEffect(
    () => () => urls.forEach((url) => URL.revokeObjectURL(url)),
    [urls],
  );
  return (
    <section className="ec-reference-group" aria-label={title}>
      {required ? (
        <div className="ec-section-heading">
          <strong>{title}</strong>
          <small>必填 · 1–2 张</small>
        </div>
      ) : (
        <button
          type="button"
          className="ec-reference-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <strong>{title}</strong>
          <small>
            {files.length ? `已添加 ${files.length} 张 · 会用于生成` : "选填"}
          </small>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
      {(required || expanded) && (
        <>
          <p>
            {kind === "person"
              ? "用于人物、姿势和场景，商品款式仍以原图为准。"
              : "只参考构图、光影和背景，商品外观以原图为准。"}
          </p>
          <div className="ec-reference-list">
            {files.map((file, index) => (
              <div className="ec-reference-thumb" key={`${file.name}-${index}`}>
                <img src={urls[index]} alt={`${title} ${index + 1}`} />
                <button
                  type="button"
                  aria-label={`移除${title} ${index + 1}`}
                  onClick={() => onChange(files.filter((_, i) => i !== index))}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {files.length < 2 && (
              <label className="ec-reference-add">
                <Upload size={16} />
                <span>添加参考</span>
                <input
                  aria-label={`上传${title}`}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    const incoming = Array.from(
                      event.currentTarget.files || [],
                    ).filter((f) => f.type.startsWith("image/"));
                    onChange([...files, ...incoming].slice(0, 2));
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function ImageParameterFields({
  parameters,
  values,
  onChange,
}: {
  parameters: ParamConfig[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  return (
    <section className="ec-model-parameters" aria-label="模型生成参数">
      <div className="ec-section-heading">
        <strong>生成参数</strong>
        <small>与画布共用模型配置</small>
      </div>
      {parameters.length ? (
        <div className="ecommerce-fields">
          {parameters.map((p) => (
            <label key={p.id}>
              {p.label}
              <select
                aria-label={p.label}
                value={values[p.id] || ""}
                onChange={(e) => onChange(p.id, e.target.value)}
              >
                {p.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : (
        <p>此模型暂未声明可调图片参数，将使用接口默认值。</p>
      )}
      <small>切换模型后使用该模型的有效参数；实际像素以返回图片为准。</small>
    </section>
  );
}
