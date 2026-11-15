import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { TuziAccountIcon } from "@/components/icons/TuziAccountIcon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TuziSidebar, type TuziSidebarProps } from "./TuziSidebar";

/** Creative work uses a top dropdown without changing the saved sidebar width. */
export function TuziNavigation(props: TuziSidebarProps) {
  const [open, setOpen] = useState(false);
  if (props.currentView !== "creative") return <TuziSidebar {...props} />;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="兔子助手导航"
          className="tuzi-creative-navigation tuzi-top-navigation-arrival mr-3 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          <TuziAccountIcon
            size={22}
            className="tuzi-navigation-icon"
          />
          <span className="tuzi-navigation-label">兔子助手</span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={open ? "rotate-180" : ""}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="兔子助手导航"
        side="bottom"
        align="start"
        sideOffset={10}
        className="flex h-[min(680px,var(--radix-popover-content-available-height))] w-[260px] flex-col overflow-hidden rounded-xl p-0 shadow-xl"
      >
        <TuziSidebar
          {...props}
          presentation="menu"
          collapsed={false}
          onToggleCollapsed={() => setOpen(false)}
          onNavigate={(view) => {
            setOpen(false);
            props.onNavigate(view);
          }}
          onOpenSettings={() => {
            setOpen(false);
            props.onOpenSettings();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
