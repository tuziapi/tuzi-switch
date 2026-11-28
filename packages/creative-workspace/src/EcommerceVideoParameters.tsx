import type { ParamConfig } from "../upstream/packages/drawnix/src/constants/model-config";

export function EcommerceVideoParameters({
  parameters,
  values,
  onChange,
}: {
  parameters: ParamConfig[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  const render = (p: ParamConfig) => (
    <label key={p.id}>
      {p.label}
      {p.options ? (
        <select
          aria-label={p.label}
          value={values[p.id] ?? p.defaultValue ?? ""}
          onChange={(e) => onChange(p.id, e.target.value)}
        >
          {!p.defaultValue && <option value="">服务默认</option>}
          {p.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : p.control === "textarea" ? (
        <textarea
          aria-label={p.label}
          rows={3}
          value={values[p.id] || ""}
          onChange={(e) => onChange(p.id, e.target.value)}
        />
      ) : (
        <input
          aria-label={p.label}
          type={p.valueType === "number" ? "number" : "text"}
          min={p.min}
          max={p.max}
          step={p.step}
          value={values[p.id] || ""}
          onChange={(e) => onChange(p.id, e.target.value)}
        />
      )}
      {p.description && <small>{p.description}</small>}
    </label>
  );
  const main = parameters.filter(
    (p) => !p.advanced || p.id === "vidu_sound_urls",
  );
  const advanced = parameters.filter(
    (p) => p.advanced && p.id !== "vidu_sound_urls",
  );
  return (
    <>
      {main.length > 0 && (
        <div className="ecommerce-fields ec-video-parameters">
          {main.map(render)}
        </div>
      )}
      {advanced.length > 0 && (
        <details className="ec-video-advanced">
          <summary>更多视频参数</summary>
          <div className="ecommerce-fields ec-video-parameters">
            {advanced.map(render)}
          </div>
        </details>
      )}
    </>
  );
}
