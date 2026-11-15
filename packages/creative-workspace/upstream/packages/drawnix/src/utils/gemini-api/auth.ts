import communityQrUrl from '../../../../../apps/web/public/logo/opentu-community-qr.png';
import supportQrUrl from '../../../../../apps/web/public/logo/opentu-support-qr.png';
/**
 * Gemini API 认证和配置管理
 */

import { GeminiConfig } from './types';
import { geminiSettings } from '../settings-manager';
import { isTuziEmbeddedMode } from '../../services/tuzi-embedded-config';
import './auth-dialog.scss';

type ApiKeyPromptOptions = {
  contextId: string;
  providerName: string;
  showTuziGuide?: boolean;
  container?: HTMLElement;
  onSave: (apiKey: string) => Promise<void>;
};
let activePrompt: { contextId: string; promise: Promise<string | null> } | null = null;

/** Reuse the credential dialog without writing a channel key to global settings. */
export function promptForApiKey(options?: ApiKeyPromptOptions): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const contextId = options?.contextId || 'legacy-default';
  if (activePrompt) return activePrompt.contextId === contextId ? activePrompt.promise : Promise.resolve(null);

  const promise = new Promise<string | null>((resolve) => {
    // 创建弹窗遮罩
    const overlay = document.createElement('div');
    overlay.className = 'api-key-overlay';

    // 创建弹窗内容
    const dialog = document.createElement('div');
    dialog.className = 'api-key-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'api-key-dialog-title');

    dialog.innerHTML = `
      <header class="api-key-dialog__header">
        <h3 id="api-key-dialog-title">配置 API Key</h3>
        <p>填写后将自动保存到本地，下次无需重复输入。</p>
      </header>
      <div class="api-key-dialog__guide">
        <div class="api-key-dialog__links">
          <a href="https://api.tu-zi.com/token" target="_blank" rel="noopener noreferrer">获取 API Key</a>
          <a class="api-key-dialog__tutorial" href="https://www.bilibili.com/video/BV1k4PqzPEKz/" target="_blank" rel="noopener noreferrer">视频教程（B站）</a>
        </div>
        <p>新建令牌时，渠道分组请选择 <strong>default</strong></p>
      </div>
      <div class="api-key-dialog__support">
        <figure>
          <div class="api-key-dialog__qr">
            <img src="${communityQrUrl}" alt="OpenTu 交流群二维码" />
          </div>
          <figcaption>OpenTu 交流群</figcaption>
        </figure>
        <figure>
          <div class="api-key-dialog__qr">
            <img src="${supportQrUrl}" alt="微信客服二维码" />
          </div>
          <figcaption>微信客服</figcaption>
        </figure>
      </div>
      <label class="api-key-dialog__label" for="apiKeyInput">API Key</label>
      <input class="api-key-dialog__input" type="password" autocomplete="off" id="apiKeyInput" placeholder="粘贴你的 API Key" />
      <p id="apiKeyError" role="alert"></p>
      <div class="api-key-dialog__actions">
        <button id="cancelBtn" type="button">取消</button>
        <button id="confirmBtn" type="button" class="api-key-dialog__confirm">确认</button>
      </div>
    `;

    if (options) {
      dialog.querySelector('h3')!.textContent = `配置 ${options.providerName} API Key`;
      dialog.querySelector('header p')!.textContent = '填写当前渠道的 API Key；渠道编辑中的改动需保存后生效。';
      if (!options.showTuziGuide) {
        dialog.querySelector('.api-key-dialog__guide')?.remove();
        dialog.querySelector('.api-key-dialog__support')?.remove();
      }
    }
    overlay.appendChild(dialog);
    // Keep nested prompts inside the active UI focus scope (for example, an
    // Ant Design model modal) so its focus trap does not steal input focus.
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (options?.container || document.getElementById('creative-portals') || document.body).appendChild(overlay);

    // 获取元素
    const input = dialog.querySelector('#apiKeyInput') as HTMLInputElement;
    const cancelBtn = dialog.querySelector('#cancelBtn') as HTMLButtonElement;
    const confirmBtn = dialog.querySelector('#confirmBtn') as HTMLButtonElement;

    // 阻止所有键盘事件冒泡到页面其他元素（防止输入被捕获到表格等）
    const stopKeyboardPropagation = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.type !== 'keydown') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      } else if (e.key === 'Tab') {
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], input, button'))
          .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
        const index = controls.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }
    };
    overlay.addEventListener('keydown', stopKeyboardPropagation);
    overlay.addEventListener('keyup', stopKeyboardPropagation);
    overlay.addEventListener('keypress', stopKeyboardPropagation);

    // 自动聚焦到输入框
    input.focus();

    // 清理函数
    const cleanup = () => {
      overlay.removeEventListener('keydown', stopKeyboardPropagation);
      overlay.removeEventListener('keyup', stopKeyboardPropagation);
      overlay.removeEventListener('keypress', stopKeyboardPropagation);
      overlay.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
    };

    let saving = false;
    const dismiss = () => { if (!saving) { cleanup(); resolve(null); } };
    // 确认按钮点击
    confirmBtn.addEventListener('click', async () => {
      if (saving) return;
      const apiKey = input.value.trim();
      if (apiKey) {
        saving = true;
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        try {
          if (options) await options.onSave(apiKey);
          else await geminiSettings.update({ apiKey });
          cleanup();
          resolve(apiKey);
        } catch {
          dialog.querySelector('#apiKeyError')!.textContent = '保存失败，请重试。';
        } finally { saving = false; confirmBtn.disabled = false; cancelBtn.disabled = false; }
      } else {
        input.style.borderColor = '#ff4d4f';
        input.focus();
      }
    });

    // 取消按钮点击
    cancelBtn.addEventListener('click', dismiss);

    // 回车键确认
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        confirmBtn.click();
      }
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss();
    });
  });
  activePrompt = { contextId, promise };
  void promise.finally(() => { if (activePrompt?.promise === promise) activePrompt = null; });
  return promise;
}

/**
 * 验证并确保配置有效，如果缺少 API Key 则弹窗获取
 */
export async function validateAndEnsureConfig(
  config: GeminiConfig
): Promise<GeminiConfig> {
  // 检查 baseUrl
  if (!config.baseUrl) {
    throw new Error('Base URL 是必需的');
  }

  // 检查 apiKey，优先从全局设置获取
  if (!config.apiKey) {
    // 首先尝试从全局设置获取
    const globalSettings = geminiSettings.get();
    if (globalSettings.apiKey) {
      // 更新原始config对象
      config.apiKey = globalSettings.apiKey;
      return config;
    }

    // 如果全局设置中也没有，则弹窗获取
    const newApiKey = await promptForApiKey();
    if (!newApiKey) {
      throw new Error('API Key 是必需的，操作已取消');
    }

    // 更新原始config对象
    config.apiKey = newApiKey;
    return config;
  }

  return config;
}

/**
 * 检查字符串是否是占位符格式
 * 如 {key}、${key}、{{key}}、{apiKey} 等
 */
function isPlaceholder(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  // 匹配 {xxx}、${xxx}、{{xxx}} 等占位符格式
  return (
    /^[{$]*\{?\w+\}?\}*$/.test(value) ||
    value.includes('{key}') ||
    value.includes('${')
  );
}

/**
 * 从URL参数中获取apiKey
 */
function getApiKeyFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (isTuziEmbeddedMode()) return null;

  const urlParams = new URLSearchParams(window.location.search);
  const apiKey = urlParams.get('apiKey');

  // 验证 apiKey 不是占位符格式
  if (isPlaceholder(apiKey)) {
    console.warn(
      '[Auth] Detected placeholder in URL apiKey, ignoring:',
      apiKey
    );
    return null;
  }

  return apiKey;
}

/**
 * 从URL参数中获取settings配置
 */
function getSettingsFromUrl(): { apiKey?: string; baseUrl?: string } | null {
  if (typeof window === 'undefined') return null;
  if (isTuziEmbeddedMode()) return null;

  const urlParams = new URLSearchParams(window.location.search);
  const settingsParam = urlParams.get('settings');

  if (!settingsParam) return null;

  try {
    const decoded = decodeURIComponent(settingsParam);
    const settings = JSON.parse(decoded);

    // 验证 apiKey 不是占位符格式
    const apiKey = isPlaceholder(settings.key) ? undefined : settings.key;
    if (settings.key && isPlaceholder(settings.key)) {
      console.warn(
        '[Auth] Detected placeholder in settings.key, ignoring:',
        settings.key
      );
    }

    return {
      apiKey,
      baseUrl: settings.url,
    };
  } catch (error) {
    console.warn('Failed to parse settings parameter:', error);
    return null;
  }
}

/**
 * 从URL中移除apiKey参数
 */
function removeApiKeyFromUrl(): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  let hasChanges = false;

  if (url.searchParams.has('apiKey')) {
    url.searchParams.delete('apiKey');
    hasChanges = true;
  }

  if (url.searchParams.has('settings')) {
    url.searchParams.delete('settings');
    hasChanges = true;
  }

  if (hasChanges) {
    window.history.replaceState({}, document.title, url.toString());
  }
}

/**
 * 初始化设置：从URL获取settings参数并处理
 */
export function initializeSettings(): void {
  if (isTuziEmbeddedMode()) {
    removeApiKeyFromUrl();
    return;
  }
  // 处理settings参数
  const settings = getSettingsFromUrl();
  // 处理单独的apiKey参数
  const apiKey = getApiKeyFromUrl();

  if (settings?.apiKey || settings?.baseUrl || apiKey) {
    geminiSettings.update({
      ...(settings?.apiKey && { apiKey: settings.apiKey }),
      ...(settings?.baseUrl && { baseUrl: settings.baseUrl }),
      ...(apiKey && { apiKey: apiKey }),
    });

    // Remove parameters from URL after processing
    const url = new URL(window.location.href);
    if (settings?.apiKey || settings?.baseUrl) {
      url.searchParams.delete('settings');
    }
    if (apiKey) {
      url.searchParams.delete('apiKey');
    }
    window.history.replaceState({}, '', url.toString());
  }
}

// Initialize settings from URL if present
if (typeof window !== 'undefined') {
  if (isTuziEmbeddedMode()) {
    removeApiKeyFromUrl();
  } else {
    // 处理settings参数
    const settings = getSettingsFromUrl();
    // 处理单独的apiKey参数
    const apiKey = getApiKeyFromUrl();

    if (settings?.apiKey || settings?.baseUrl || apiKey) {
      geminiSettings.update({
        ...(settings?.apiKey && { apiKey: settings.apiKey }),
        ...(settings?.baseUrl && { baseUrl: settings.baseUrl }),
        ...(apiKey && { apiKey: apiKey }),
      });
      removeApiKeyFromUrl();
    }
  }
}
