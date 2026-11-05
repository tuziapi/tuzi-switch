import opentuLogo from "@/assets/opentu-logo.png";
import { cn } from "@/lib/utils";

/** Original opentu brand asset; the surrounding control provides its label. */
export function OpentuIcon({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={opentuLogo}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 rounded-sm object-contain", className)}
    />
  );
}
