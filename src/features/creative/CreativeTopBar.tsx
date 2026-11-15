import type { ReactNode } from "react";
import { LayoutGrid, MousePointer2, Settings2 } from "lucide-react";
import type { CreativePage } from "@tuzi/creative-workspace";
import { DRAG_REGION_ATTR, DRAG_REGION_STYLE } from "@/lib/platform";
import { cn } from "@/lib/utils";
import "./creative-top-bar.css";

const pages = [
  { id: "projects", label: "我的项目", icon: LayoutGrid },
  { id: "canvas", label: "自由画布", icon: MousePointer2 },
] as const;

export function CreativeTopBar({
  page,
  onPageChange,
  onOpenSettings,
  navigation,
  reserveMacControls = false,
  reserveWindowControls = false,
}: {
  page: CreativePage;
  onPageChange: (page: CreativePage) => void;
  onOpenSettings: () => void;
  navigation?: ReactNode;
  reserveMacControls?: boolean;
  reserveWindowControls?: boolean;
}) {
  return (
    <header
      className={cn(
        "creative-top-bar",
        reserveMacControls && "creative-top-bar--mac",
        reserveWindowControls && "creative-top-bar--window-controls",
      )}
      aria-label="创作工具栏"
      {...DRAG_REGION_ATTR}
      style={DRAG_REGION_STYLE}
    >
      {navigation && (
        <>
          <div className="creative-top-bar__brand no-drag">{navigation}</div>
          <span className="creative-top-bar__divider" aria-hidden="true" />
        </>
      )}
      <nav className="creative-top-bar__tabs no-drag" aria-label="创作导航">
        {pages.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onPageChange(id)}
            aria-current={page === id ? "page" : undefined}
            aria-label={label}
            title={label}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <button
        type="button"
        onClick={onOpenSettings}
        className="creative-top-bar__settings no-drag"
        aria-label="创作配置"
        title="创作配置"
      >
        <Settings2 size={15} aria-hidden="true" />
        <span>创作配置</span>
      </button>
      <div
        className="creative-top-bar__drag"
        aria-hidden="true"
        {...DRAG_REGION_ATTR}
        style={DRAG_REGION_STYLE}
      />
      <div className="creative-top-bar__actions no-drag">
        <div id="creative-chat-entry" />
      </div>
    </header>
  );
}
