/**
 * 错误分类器
 *
 * 将 API 错误分类为结构化类型，并提供中文用户友好提示。
 * 不修改错误对象本身，只在 catch 块中附加友好消息。
 */

// ==================== 错误类型枚举 ====================

/** 错误类别 */
export enum ErrorCategory {
  /** 认证错误：API Key 无效或过期 */
  AUTH = 'auth',
  /** 网络错误：无法连接到服务器 */
  NETWORK = 'network',
  /** 超时错误 */
  TIMEOUT = 'timeout',
  /** 服务器错误：5xx */
  SERVER = 'server',
  /** 限流错误：429 */
  RATE_LIMIT = 'rate_limit',
  /** 参数错误：400/422 */
  VALIDATION = 'validation',
  /** 内容过大：413 */
  CONTENT_TOO_LARGE = 'content_too_large',
  /** 请求被取消 */
  CANCELLED = 'cancelled',
  /** 未知错误 */
  UNKNOWN = 'unknown',
}

// ==================== 分类结果 ====================

export interface ClassifiedError {
  category: ErrorCategory;
  /** 原始错误消息（用于调试） */
  originalMessage: string;
  /** 用户友好提示 */
  friendlyMessage: string;
  /** HTTP 状态码（如果有） */
  httpStatus?: number;
  /** 上游请求 ID（如果有） */
  requestId?: string;
  /** 是否建议重试 */
  retryable: boolean;
}

// ==================== 友好提示映射 ====================

const FRIENDLY_MESSAGES: Record<ErrorCategory, string> = {
  [ErrorCategory.AUTH]: 'API Key 无效或已过期，请在设置页面检查并更新 API Key',
  [ErrorCategory.NETWORK]: '网络连接失败，请检查网络连接后重试',
  [ErrorCategory.TIMEOUT]:
    '请求超时，可能是网络不稳定或图片过大，建议缩小图片尺寸后重试',
  [ErrorCategory.SERVER]: '服务暂时不可用，请稍后重试',
  [ErrorCategory.RATE_LIMIT]: '请求过于频繁，请稍等片刻后重试',
  [ErrorCategory.VALIDATION]: '请求参数有误，请检查模型和参数设置是否正确',
  [ErrorCategory.CONTENT_TOO_LARGE]: '上传的图片过大，请压缩后重试',
  [ErrorCategory.CANCELLED]: '任务已取消',
  [ErrorCategory.UNKNOWN]: '操作失败，请重试或联系技术支持',
};

// ==================== 上下文提示 ====================

/** 任务类型对应的上下文描述 */
const TASK_CONTEXT: Record<string, string> = {
  image: '图片生成',
  video: '视频生成',
  text: '文本生成',
  chat: '对话生成',
  audio: '音频生成',
  analyze: 'AI 分析',
  async_image: '异步图片生成',
};

// ==================== 分类函数 ====================

/**
 * 从 HTTP 状态码判断错误类别
 */
function classifyByHttpStatus(status: number): ErrorCategory {
  if (status === 401 || status === 403) return ErrorCategory.AUTH;
  if (status === 429) return ErrorCategory.RATE_LIMIT;
  if (status === 400 || status === 422) return ErrorCategory.VALIDATION;
  if (status === 413) return ErrorCategory.CONTENT_TOO_LARGE;
  if (status >= 500) return ErrorCategory.SERVER;
  return ErrorCategory.UNKNOWN;
}

/**
 * 从错误消息中提取 HTTP 状态码
 */
function extractHttpStatus(message: string): number | undefined {
  const match = message.match(/HTTP\s*(\d{3})/i);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * 从错误消息中提取上游请求 ID
 */
function extractRequestId(message: string): string | undefined {
  const match = message.match(
    /(?:request[\s_-]*id|请求\s*(?:id|编号))\s*[:：=]?\s*([A-Za-z0-9][A-Za-z0-9._-]{5,127})/i
  );
  return match?.[1];
}

/**
 * 判断是否为认证错误。部分兼容接口会以 400 返回中文错误，不能只依赖状态码。
 */
function isAuthError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('无效的令牌') ||
    message.includes('令牌无效') ||
    message.includes('无效的 api key') ||
    message.includes('api key 无效') ||
    message.includes('认证失败') ||
    message.includes('鉴权失败') ||
    message.includes('invalid token') ||
    message.includes('invalid api key') ||
    message.includes('incorrect api key') ||
    message.includes('invalid_api_key') ||
    message.includes('authentication failed') ||
    message.includes('authentication_error') ||
    message.includes('unauthorized')
  );
}

/**
 * 判断是否为网络错误
 */
function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('fetcherror') ||
    message.includes('net::err') ||
    error.name === 'TypeError'
  );
}

/**
 * 判断是否为超时错误
 */
function isTimeoutError(error: Error): boolean {
  return (
    error.name === 'TimeoutError' ||
    error.message.includes('timeout') ||
    error.message.includes('超时')
  );
}

/**
 * 判断是否为取消错误
 */
function isCancelledError(error: Error): boolean {
  return (
    error.name === 'AbortError' ||
    error.message.includes('cancelled') ||
    error.message.includes('abort')
  );
}

/**
 * 分类错误
 *
 * @param error - 捕获的错误对象
 * @param taskType - 任务类型（用于添加上下文）
 * @returns 分类后的错误信息
 */
export function classifyError(
  error: Error,
  taskType?: string
): ClassifiedError {
  const originalMessage = error.message || '未知错误';
  let category = ErrorCategory.UNKNOWN;
  let httpStatus: number | undefined;
  const requestId = extractRequestId(originalMessage);

  // 1. 按优先级检测错误类型
  if (isCancelledError(error)) {
    category = ErrorCategory.CANCELLED;
  } else if (isTimeoutError(error)) {
    category = ErrorCategory.TIMEOUT;
  } else if (isAuthError(error)) {
    category = ErrorCategory.AUTH;
  } else if (isNetworkError(error)) {
    category = ErrorCategory.NETWORK;
  } else {
    // 2. 从消息中提取 HTTP 状态码
    httpStatus = extractHttpStatus(originalMessage);
    if (httpStatus) {
      category = classifyByHttpStatus(httpStatus);
    }
  }

  // 3. 判断是否可重试
  const retryable =
    category === ErrorCategory.SERVER ||
    category === ErrorCategory.RATE_LIMIT ||
    category === ErrorCategory.NETWORK ||
    category === ErrorCategory.TIMEOUT;

  // 4. 构建友好消息
  let friendlyMessage = FRIENDLY_MESSAGES[category];
  const context = taskType ? TASK_CONTEXT[taskType] : undefined;
  if (context) {
    friendlyMessage = `${context}失败：${friendlyMessage}`;
  }

  return {
    category,
    originalMessage,
    friendlyMessage,
    httpStatus,
    requestId,
    retryable,
  };
}

/**
 * 格式化错误消息（包含原始消息和友好提示）
 * 用于在 taskStorageWriter.failTask 中设置 message 字段
 */
export function formatFriendlyError(error: Error, taskType?: string): string {
  const classified = classifyError(error, taskType);
  return classified.requestId
    ? `${classified.friendlyMessage}（请求 ID：${classified.requestId}）`
    : classified.friendlyMessage;
}

/**
 * 获取错误类别（轻量版，不生成完整消息）
 */
export function getErrorCategory(error: Error): ErrorCategory {
  return classifyError(error).category;
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(error: Error): boolean {
  return classifyError(error).retryable;
}
