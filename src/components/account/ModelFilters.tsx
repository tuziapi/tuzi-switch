import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";
export const billingLabels: Record<string, string> = {
  "0": "按次",
  "1": "按量",
  "2": "按秒",
};
const fields = [
  { key: "vendor", facet: "vendors", label: "供应商" },
  { key: "quota_type", facet: "quota_types", label: "计费模式" },
  { key: "endpoint_type", facet: "endpoint_types", label: "接口类型" },
  { key: "group", facet: "groups", label: "可用分组" },
  { key: "tag", facet: "tags", label: "标签" },
];
function Choices({
  label,
  value,
  options,
  multiple,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  multiple?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = value ? value.split(",") : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
        >
          {label}：
          {chosen.length
            ? chosen
                .map((v) => options.find(([key]) => key === v)?.[1] ?? v)
                .join("、")
            : "全部"}{" "}
          ▾
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Command>
          <CommandInput placeholder={`搜索${label}`} />
          <CommandList>
            <CommandEmpty>没有匹配选项</CommandEmpty>
            <CommandItem
              onSelect={() => {
                onChange("");
                setOpen(false);
              }}
            >
              全部
            </CommandItem>
            {options.map(([key, text]) => (
              <CommandItem
                key={key}
                value={text}
                onSelect={() => {
                  onChange(
                    multiple
                      ? (chosen.includes(key)
                          ? chosen.filter((v) => v !== key)
                          : [...chosen, key]
                        ).join(",")
                      : key,
                  );
                  if (!multiple) setOpen(false);
                }}
              >
                {chosen.includes(key) ? "✓ " : ""}
                {text}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
export function ModelFilters({
  meta,
  values,
  status,
  onChange,
}: {
  meta: Record<string, unknown>;
  values: Record<string, string>;
  status: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const facets =
    meta.filter_facets && typeof meta.filter_facets === "object"
      ? (meta.filter_facets as Record<string, unknown>)
      : {};
  const field = (f: (typeof fields)[number]) => {
    const facet = facets[f.facet];
    const keys =
      f.key === "quota_type"
        ? ["1", "0", "2"]
        : facet && typeof facet === "object"
          ? Object.keys(facet)
          : [];
    return (
      <Choices
        key={f.key}
        label={f.label}
        value={values[f.key] ?? ""}
        multiple={f.key === "tag"}
        options={keys.map((k) => [
          k,
          f.key === "quota_type"
            ? (billingLabels[k] ?? k)
            : k === "unknown"
              ? "其他"
              : k,
        ])}
        onChange={(v) => onChange(f.key, v)}
      />
    );
  };
  return (
    <div className="account-model-filter-options">
      {fields
        .filter((f) =>
          status ? ["endpoint_type", "group"].includes(f.key) : f.key !== "tag",
        )
        .map(field)}
      {!status && (
        <details>
          <summary>更多筛选</summary>
          {field(fields[4])}
        </details>
      )}
      {Object.entries(values)
        .filter(([k, v]) => k !== "search" && v)
        .map(([k, v]) => (
          <button
            type="button"
            className="account-badge"
            key={k}
            onClick={() => onChange(k, "")}
          >
            {fields.find((f) => f.key === k)?.label}：
            {k === "quota_type" ? billingLabels[v] : v} ×
          </button>
        ))}
    </div>
  );
}
