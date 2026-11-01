import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./account-polish.css";

export function AccountDialog({
  title,
  description,
  children,
  footer,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        zIndex="alert"
        className="account-modal"
        {...(!description ? { "aria-describedby": undefined } : {})}
      >
        <DialogHeader className="relative pr-14">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
          <Button
            className="absolute right-4 top-4"
            variant="ghost"
            size="icon"
            aria-label={t("common.close") + "窗口"}
            onClick={onClose}
          >
            <X size={18} />
          </Button>
        </DialogHeader>
        <div className="account-modal-body">{children}</div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
