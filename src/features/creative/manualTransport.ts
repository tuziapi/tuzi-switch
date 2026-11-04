import { nativeCreativeResponse } from "./nativeStream";
import { prepareCreativeRequest } from "./requestTransport";

export async function requestCreativeManual(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const request = await prepareCreativeRequest(url, init);
  return nativeCreativeResponse(
    "creative_manual_request",
    "creative_manual_cancel",
    request,
    init.signal,
    (error) =>
      new Error(
        error === "creative_redirect_rejected"
          ? "接口发生重定向，请在配置中填写最终接口地址。"
          : "请求未完成，请检查配置或查询任务结果，避免重复提交。",
      ),
  );
}
