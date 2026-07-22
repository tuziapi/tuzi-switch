import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  ExternalLink,
  History,
  Search,
  X,
  Sparkles,
  Wrench,
  Bug,
  Gauge,
  Blocks,
  ShieldCheck,
  Network,
  FileText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUpdate } from "@/contexts/UpdateContext";
import { settingsApi } from "@/lib/api";
import {
  productReleases,
  type ReleaseChangeCategory,
} from "@/data/versionHistory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

const CATEGORY_ICONS = {
  feature: Sparkles,
  enhancement: Wrench,
  fix: Bug,
  performance: Gauge,
  compatibility: Blocks,
  security: ShieldCheck,
  architecture: Network,
  engineering: Wrench,
  documentation: FileText,
} satisfies Record<ReleaseChangeCategory, typeof History>;

const normalizeVersion = (version?: string) =>
  version?.trim().replace(/^v/i, "") ?? "";

export function VersionHistory() {
  const { t } = useTranslation();
  const { hasUpdate, updateInfo } = useUpdate();
  const [open, setOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("");
  const [query, setQuery] = useState("");
  const [expandedVersions, setExpandedVersions] = useState<string[]>([]);
  const [category, setCategory] = useState<ReleaseChangeCategory | "all">(
    "all",
  );

  useEffect(() => {
    if (!open || currentVersion) return;
    let active = true;
    getVersion()
      .then((version) => active && setCurrentVersion(normalizeVersion(version)))
      .catch(() => active && setCurrentVersion(""));
    return () => {
      active = false;
    };
  }, [currentVersion, open]);

  const latestVersion = normalizeVersion(productReleases[0]?.version);
  const filteredReleases = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return productReleases
      .map((release) => ({
        ...release,
        changes: release.changes.filter((change) => {
          const matchesCategory =
            category === "all" || change.category === category;
          const matchesKeyword =
            !keyword ||
            release.version.toLocaleLowerCase().includes(keyword) ||
            change.title.toLocaleLowerCase().includes(keyword) ||
            change.description?.toLocaleLowerCase().includes(keyword);
          return matchesCategory && matchesKeyword;
        }),
      }))
      .filter((release) => {
        if (release.changes.length > 0) return true;
        return (
          category === "all" &&
          release.version.toLocaleLowerCase().includes(keyword)
        );
      });
  }, [category, query]);

  const defaultExpanded = useMemo(() => {
    const matched = productReleases.find(
      (release) => normalizeVersion(release.version) === currentVersion,
    );
    return [matched?.version ?? productReleases[0]?.version].filter(
      Boolean,
    ) as string[];
  }, [currentVersion]);

  useEffect(() => {
    if (open && expandedVersions.length === 0) {
      setExpandedVersions(defaultExpanded);
    }
  }, [defaultExpanded, expandedVersions.length, open]);

  const hasActiveFilters = query.trim().length > 0 || category !== "all";

  const resetFilters = () => {
    setQuery("");
    setCategory("all");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title={t("versionHistory.title")}
        aria-label={t("versionHistory.open")}
        onClick={() => setOpen(true)}
        className="relative hover:bg-black/5 dark:hover:bg-white/5"
      >
        <History className="h-4 w-4" />
        {hasUpdate && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500 ring-2 ring-background" />
        )}
      </Button>

      <DialogContent
        className="h-[88vh] max-w-3xl p-0 sm:h-[82vh]"
        zIndex="top"
      >
        <DialogHeader className="space-y-3">
          <div className="flex items-start justify-between gap-4 pr-1">
            <div>
              <DialogTitle>{t("versionHistory.title")}</DialogTitle>
              <DialogDescription>
                {t("versionHistory.summary", { count: productReleases.length })}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("versionHistory.close")}
                className="-mr-2 -mt-2 h-8 w-8 shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {currentVersion && (
              <Badge variant="outline">
                {t("versionHistory.currentVersion")}: v{currentVersion}
              </Badge>
            )}
            <Badge variant="outline">
              {t("versionHistory.latestVersion")}: v{latestVersion}
            </Badge>
            {hasUpdate && updateInfo?.availableVersion && (
              <Badge className="bg-emerald-600 hover:bg-emerald-600">
                {t("versionHistory.updateAvailable", {
                  version: updateInfo.availableVersion,
                })}
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("versionHistory.searchPlaceholder")}
                className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as ReleaseChangeCategory | "all")
              }
              aria-label={t("versionHistory.filterLabel")}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring sm:max-w-44"
            >
              <option value="all">{t("versionHistory.categories.all")}</option>
              {Object.keys(CATEGORY_ICONS).map((key) => (
                <option key={key} value={key}>
                  {t(`versionHistory.categories.${key}`)}
                </option>
              ))}
            </select>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-9 shrink-0"
              >
                {t("versionHistory.resetFilters")}
              </Button>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 px-6">
          {filteredReleases.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {t("versionHistory.empty")}
            </div>
          ) : (
            <Accordion
              type="multiple"
              value={expandedVersions}
              onValueChange={setExpandedVersions}
              className="pb-6"
            >
              {filteredReleases.map((release) => {
                const normalized = normalizeVersion(release.version);
                const isCurrent = normalized === currentVersion;
                const isLatest = normalized === latestVersion;
                const grouped = Object.entries(
                  release.changes.reduce<
                    Partial<
                      Record<ReleaseChangeCategory, typeof release.changes>
                    >
                  >((result, change) => {
                    (result[change.category] ??= []).push(change);
                    return result;
                  }, {}),
                ) as [ReleaseChangeCategory, typeof release.changes][];

                return (
                  <AccordionItem key={release.version} value={release.version}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left">
                        <span className="text-base font-semibold">
                          {release.version}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {release.publishedAt}
                        </span>
                        {isCurrent && (
                          <Badge variant="secondary">
                            {t("versionHistory.current")}
                          </Badge>
                        )}
                        {isLatest && (
                          <Badge>{t("versionHistory.latest")}</Badge>
                        )}
                        <span className="ml-auto mr-3 text-xs font-normal text-muted-foreground">
                          {t("versionHistory.changeCount", {
                            count: release.changes.length,
                          })}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-5 rounded-lg bg-muted/30 p-4">
                        {grouped.map(([groupCategory, changes]) => {
                          const Icon = CATEGORY_ICONS[groupCategory];
                          return (
                            <section key={groupCategory} className="space-y-2">
                              <h4 className="flex items-center gap-2 text-sm font-semibold">
                                <Icon className="h-4 w-4 text-primary" />
                                {t(
                                  `versionHistory.categories.${groupCategory}`,
                                )}
                              </h4>
                              <ul className="space-y-2 pl-6 text-sm text-muted-foreground">
                                {changes.map((change, index) => (
                                  <li
                                    key={`${change.title}-${index}`}
                                    className="list-disc"
                                  >
                                    <span className="text-foreground">
                                      {change.title}
                                    </span>
                                    {change.description && (
                                      <p className="mt-1 leading-relaxed">
                                        {change.description}
                                      </p>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </section>
                          );
                        })}
                        {release.releaseUrl && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() =>
                              settingsApi.openExternal(release.releaseUrl!)
                            }
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {t("versionHistory.viewRelease")}
                          </Button>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
