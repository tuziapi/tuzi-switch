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
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{
        duration: reduceMotion ? 0 : 0.18,
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
