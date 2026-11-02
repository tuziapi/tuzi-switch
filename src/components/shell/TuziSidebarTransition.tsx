import type { ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "framer-motion";
import "./workspace-transition.css";

function AnimatedSidebar({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="tuzi-sidebar-transition"
      data-exiting={!present}
      aria-hidden={!present || undefined}
      {...(!present ? { inert: "" } : {})}
      initial={{ clipPath: "inset(0 0 100% 0)", opacity: 0, y: -12 }}
      animate={{ clipPath: "inset(0 0 0% 0)", opacity: 1, y: 0 }}
      exit={{ clipPath: "inset(0 0 100% 0)", opacity: 0, y: -12 }}
      transition={{
        duration: reduceMotion ? 0 : 0.28,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}

/** Keep the outgoing navigation only for its visual exit, with input disabled. */
export function TuziSidebarTransition({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <AnimatedSidebar key="assistant-sidebar">{children}</AnimatedSidebar>
      )}
    </AnimatePresence>
  );
}
