import rabbitIcon from "@/assets/tuzi-account-rabbit.png";
import { cn } from "@/lib/utils";

/** Decorative brand mark; the surrounding account control provides its label. */
export function TuziAccountIcon({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={rabbitIcon}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
