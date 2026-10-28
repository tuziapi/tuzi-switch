import React from "react";

interface ListItemRowProps {
  isLast?: boolean;
  children: React.ReactNode;
}

export const ListItemRow: React.FC<ListItemRowProps> = ({
  isLast,
  children,
}) => {
  return (
    <div
      className={`workspace-list-row group flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/50 transition-colors ${
        !isLast ? "border-b border-border-default" : ""
      }`}
    >
      {children}
    </div>
  );
};
