import actions from "./mediaActions.json";

const tracking = new Set(["ch", "tuzi_client", "client_channel", "channel"]);
const taskIdPattern = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}$/;

/** Only maps the bundled finite contract; no renderer URL is sent to native. */
export function selectCreativeMediaAction(url: URL, method: string) {
  for (const entry of actions) {
    if (entry.method !== method) continue;
    const template = new URL(entry.path, url.origin);
    const [prefix, suffix] = entry.path.split("?")[0].split("{taskId}");
    let taskId: string | undefined;
    if (suffix !== undefined) {
      if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix))
        continue;
      taskId = url.pathname.slice(
        prefix.length,
        suffix ? -suffix.length : undefined,
      );
    } else if (url.pathname !== template.pathname) {
      continue;
    }
    const queryKey = [...template.searchParams.keys()][0];
    if (queryKey) taskId = url.searchParams.get(queryKey) ?? "";
    if (taskId !== undefined && !taskIdPattern.test(taskId)) {
      throw new Error("生成任务编号无效。");
    }
    const seen = new Set<string>();
    for (const [key] of url.searchParams) {
      if ((!tracking.has(key) && key !== queryKey) || seen.has(key)) {
        throw new Error("账户关联不支持此请求参数。");
      }
      seen.add(key);
    }
    return {
      action: entry.action,
      ...(taskId !== undefined ? { taskId } : {}),
    };
  }
  return undefined;
}
