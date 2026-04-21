# Claude / Codex / Gemini 当前线路逻辑总梳理

这份文档用于说明当前仓库里 `Claude`、`Codex`、`Gemini` 三个入口在“状态读取、一键配置、改版切换、provider 切换、顶部显示”上的真实逻辑。

目标不是描述理想设计，而是把现在代码里的实际行为整理清楚，方便后续继续统一体验。

## 入口与关键文件

- 前端快速接入与顶部状态：
  - `src/components/BusinessQuickAccess.tsx`
- 下方 provider 切换：
  - `src/hooks/useProviderActions.ts`
- installer API 封装：
  - `src/lib/api/installer.ts`
- providers 查询与原子刷新：
  - `src/lib/query/queries.ts`
- 后端状态读取、安装、切换：
  - `src-tauri/src/product_installer.rs`

## 总体模型

这三个模块现在都不是“只看一处状态”，而是同时合并 3 类信息：

1. `实际命中的 CLI`
   - 决定当前是原版还是 `gac` 改版
2. `本地安装/配置状态`
   - 决定 installer 记录的当前线路、Base URL、版本、是否冲突
3. `current provider`
   - 决定下方哪张业务卡当前正在使用

在页面上可以简单理解成两层：

- 上方 `快速接入`
  - 是“安装器 + 业务线路入口”
  - 会做安装、改版切换、原版线路配置、业务 provider 自动创建和切换
- 下方 `ProviderList`
  - 是“当前 provider 切换入口之一”
  - 只切 `current provider`
  - 不安装、不切 CLI 变体

## 页面怎么读状态

`BusinessQuickAccess` 每次刷新都会并行读取两类数据，再一次性提交到界面：

- installer status
  - `getClaudeStatus`
  - `getCodexStatus`
  - `getGeminiStatus`
- providers/current provider
  - React Query 里的 `["providers", appId]`

这样做的原因是避免“顶部状态已经切过去了，但下方 provider 还停留在旧值”的中间态。

会触发这次原子刷新的动作有：

- 上方原版线路 `立即配置`
- 上方改版 `选择使用改版`
- 上方改版 `退出使用改版`
- 顶部手动 `刷新状态`
- 下方 provider 卡切换成功

不会触发真实状态读取的动作：

- 只点击上方路线卡切换选中态
- 只在输入框里改 Key 或模型

## 上下两块分别负责什么

### 上方路线管理卡

职责是“快速接入入口”，可以做这些事情：

- 安装原版 CLI
- 切换到改版 CLI
- 写原版业务线路配置
- 自动创建或更新业务 provider
- 自动切换到对应业务 provider

### 下方 provider 卡

职责是“当前 provider 切换入口”，只做一件事：

- 调 `providersApi.switch(...)` 切换当前 provider

它不会：

- 安装原版 CLI
- 切换改版 CLI
- 直接改 installer 的安装类型

因此“下方切到原版 provider，但顶部仍显示改版”并不一定是 bug，只要当前实际 CLI 仍然是改版，这个现象就是符合现逻辑的。

## 一键配置时 provider 怎么处理

三模块原版业务线路都会优先复用已有业务 provider。

规则是：

- 如果同一路线下已存在“同 API Key”的 provider，就更新这张卡
- 如果 Key 不同，就新建一张附加卡
- 附加卡 ID 会变成 `-alt-2`、`-alt-3` 这类形式

一键配置完成后，前端会自动 `switch` 到目标业务 provider。

这条链路会带 `skipBackfill: true`，避免把刚写好的 live 配置反灌回旧 provider。

## 改版切换的共同语义

三个模块目前都把改版当成“独占型”模式来处理，不和原版 provider 并行作为当前使用态。

### 进入改版时

- 记录 `last_original_route`
- 记录 `last_original_provider_id`
- 切到改版 CLI
- 清空当前 provider

### 退出改版时

- 切回原版 CLI
- 用 `last_original_route` 恢复原版线路配置
- 用 `last_original_provider_id` 恢复 current provider

### 升级语义

三个模块的升级按钮都只升级原版 CLI，不升级改版 CLI。

## Claude

### 线路集合

- 原版：
  - `Claude · 兔子线路`
  - `Claude · gac 线路`
- 改版：
  - `gac 改版 Claude`

### 状态读取来源

Claude 是三者里最复杂的一条线，会同时读取：

- `~/.config/tuzi/claude_route_status.txt`
- shell rc 里的 `ANTHROPIC_*`
- `~/.claude/settings.json`
- 当前实际命中的 `claude` CLI

### 当前线路读取

后端会分别从这三处推导线路：

- `settings.json`
- shell rc
- route file

当前优先级是：

`settings_route > shell_route > route_file_current_route`

如果出现以下任一情况，就标记 `sources_conflict=true`：

- 三处推导出的线路不一致
- `.zshrc` 与 `.bashrc` 的 Claude 环境变量彼此冲突

### CLI 变体读取

Claude 不是只靠包名判断原版还是改版，而是会看当前命中的 `claude` 包内容。

判断逻辑是：

- 原版：`original`
- 改版：`modified`

改版识别会检查 gac 改版特征文件，而不是只看 npm 包名。

### 原版一键配置

前端点 `Claude · 兔子线路` 或 `Claude · gac 线路` 的 `立即配置` 后，会调用：

- `install_claudecode("C")`
- `install_claudecode("B")`

后端行为分两种：

- 若当前实际 CLI 已是原版
  - 只重写原版线路配置
- 若当前实际 CLI 不是原版
  - 先安装原版 CLI
  - 再写原版线路配置

Claude 原版配置会同时覆盖：

- route file
- shell rc
- `~/.claude/settings.json`

前端随后会同步对应业务 provider，并切成 current provider。

### 改版切换

现在前端不再走旧的 `scheme A`，而是走：

- `switch_claudecode_variant`

#### 进入改版

- 记录上一次原版线路和 provider
- 安装或确认改版 CLI
- route file 设为 `改版`
- 清 shell rc 中 Claude 路由变量
- 同步 `settings.json` 到改版口径
- 清空 current provider

#### 退出改版

- 先切回原版 CLI
- 再按 `last_original_route` 恢复原版 route file / shell rc / settings.json
- 再按 `last_original_provider_id` 恢复 current provider

### Claude 的特殊点

Claude 比另外两个模块多一个 `sources_conflict`。

但现在它只保留为诊断信息，不再主导：

- 顶部 `当前线路`
- 顶部 `Base URL`
- 路线卡高亮

当前这三项会优先按 `current provider + 实际 CLI 变体` 解释，行为更接近 `Codex`。

## Codex

### 线路集合

- 原版：
  - `Codex · 兔子线路`
  - `Codex · 兔子 Coding 特别线路`
  - `Codex · gac 线路`
- 改版：
  - `gac 改版 Codex`

### 状态读取来源

Codex 主要依赖：

- `install_state`
- `~/.codex` 相关 `config/auth`
- 当前实际命中的 `codex` CLI
- current provider

### 当前线路读取

后端读取顺序更直接：

- 先看 `install_state.ROUTE`
- 再回退到 config 里的 `model_provider / profile`

前端随后再用当前 provider 反推业务线路。

### CLI 变体读取

Codex 看当前命中的 `codex` 包：

- 原版：`openai`
- 改版：`gac`

### 原版一键配置

前端点原版卡 `立即配置` 后调用：

- `install_codex({ variant: "openai", route, apiKey, model, modelReasoningEffort })`

后端行为分两种：

- 若当前实际 CLI 已是原版
  - 只重写 `config/auth/install_state`
- 若当前实际 CLI 不是原版
  - 先安装原版 CLI
  - 再写 `config/auth/install_state`

前端随后同步业务 provider，并切成 current provider。

### 改版切换

前端走：

- `switch_codex_variant`

#### 进入改版

- 记录 `LAST_ORIGINAL_ROUTE / LAST_ORIGINAL_PROVIDER_ID`
- 安装或确认 gac CLI
- 写 `INSTALL_TYPE=gac`
- 清空 current provider

#### 退出改版

- 切回原版 CLI
- 按 `LAST_ORIGINAL_ROUTE` 恢复原版 config
- 按 `LAST_ORIGINAL_PROVIDER_ID` 恢复 current provider

### 改版安装的额外保护

Codex 改版安装时，如果 `codex` command 入口和现有 launcher 冲突，安装链会先清理冲突 launcher，再复核实际命中的 CLI 是否真的已经切到改版。

## Gemini

### 线路集合

- 原版：
  - `Gemini · 兔子线路`
- 改版：
  - `gac 改版 Gemini`

### 状态读取来源

Gemini 主要依赖：

- `install_state`
- `.env`
- Gemini settings
- 当前实际命中的 `gemini` CLI
- current provider

### 当前线路读取

后端优先看：

- `install_state.ROUTE`

如果没有，再根据 `.env` 里的 `GOOGLE_GEMINI_BASE_URL` 反推线路。

### CLI 变体读取

Gemini 看当前命中的 `gemini` 包：

- 原版：`official`
- 改版：`gac`

### 原版一键配置

前端点 `Gemini · 兔子线路` 的 `立即配置` 后调用：

- `install_gemini({ variant: "official", route: "tuzi", apiKey, model })`

后端行为分两种：

- 若当前实际 CLI 已是官方版
  - 只重写 `.env + settings + install_state`
- 若当前实际 CLI 不是官方版
  - 先安装官方 CLI
  - 并确认当前第一命中的 `gemini` 已切回官方
  - 再写配置

前端随后同步业务 provider，并切成 current provider。

### 改版切换

前端走：

- `switch_gemini_variant`

#### 进入改版

- 记录 `LAST_ORIGINAL_ROUTE / LAST_ORIGINAL_PROVIDER_ID`
- 安装或确认 gac CLI
- 写 `INSTALL_TYPE=gac`
- 清空 current provider

#### 退出改版

- 切回官方 CLI
- 用 `LAST_ORIGINAL_ROUTE` 恢复原版 `.env`
- 用 `LAST_ORIGINAL_PROVIDER_ID` 恢复 current provider

### Gemini 原版安装的额外保护

Gemini 原版安装后，还会检查当前 PATH 第一命中的 `gemini`：

- 如果仍被旧改版 launcher 抢占
  - 会尝试清理冲突 command 入口
  - 再复核是否真正回到官方版

## 当前顶部显示规则

### 当前线路

三模块都会先得到这几类结果：

- `providerRoute`
- `installerRoute`
- `resolved_variant`

共同规则是：

- 只要实际 CLI 变体已是改版，顶部固定显示改版线路
- 若 CLI 变体是原版，优先按 current provider 反推业务线路
- provider 无法判定时，再回退到 installer 记录

Claude 的额外特例：

- `sources_conflict=true` 仍会显示黄色诊断提示
- 但不会再降低 provider 的优先级
- 因此只要当前 provider 能明确命中原版业务线路，顶部仍优先按 provider 显示

### Base URL

顶部 `Base URL` 的原则与“当前线路”一致：

- 改版时优先显示改版 Base URL
- 原版时优先显示 current provider 的 Base URL
- provider 无法判定时再回退到 installer status

Claude 的 Base URL 还会受 `settings.json / shell rc / route file` 的合并结果影响。

### 路线卡高亮、输入区、按钮分支

- `activeRoute`
  - 代表页面当前认为“实际正在使用”的线路
- `selectedRoute / panelRoute`
  - 代表面板当前选中的卡片和输入区

如果用户没有手动切卡：

- 面板会默认跟随 `activeRoute`

一旦用户手动点卡：

- 只改面板选中态
- 不会立刻改真实状态

真正会改真实状态的动作只有：

- `立即配置`
- `选择使用改版`
- `退出使用改版`

## 三类冲突提示

### `variant_conflict`

- 业务线路或 installer 期望的 CLI 变体
- 与真实命中的 CLI 变体不一致

### `route mismatch`

- 顶部当前线路
- 与 current provider 反推出的线路不一致

### `sources_conflict`

只有 Claude 有。

含义是：

- `route file / shell rc / settings.json` 推导出来的线路不一致
- 或 shell rc 双文件互相冲突

它当前的作用是：

- 提示本地来源不一致，建议重新执行一次配置或切换操作收口
- 不再直接改写顶部当前线路和 Base URL 的显示优先级

## 对外接口与关键状态字段

### 前端主要依赖

- `installerApi.getClaudeStatus / getCodexStatus / getGeminiStatus`
- `installerApi.installClaudeCode / installCodex / installGemini`
- `installerApi.switchClaudeVariant / switchCodexVariant / switchGeminiVariant`
- `providersApi.switch`

### 当前关键状态字段

#### Claude

- `current_route`
- `route_file_current_route`
- `effective_base_url`
- `resolved_variant`
- `variant_conflict`
- `sources_conflict`

#### Codex

- `install_type`
- `current_route`
- `resolved_variant`
- `variant_conflict`

#### Gemini

- `install_type`
- `current_route`
- `resolved_variant`
- `variant_conflict`

### 回退记忆字段

- Claude route file：
  - `last_original_route`
  - `last_original_provider_id`
- Codex / Gemini install_state：
  - `LAST_ORIGINAL_ROUTE`
  - `LAST_ORIGINAL_PROVIDER_ID`

## 验证场景

### 原版线路一键配置后

- CLI 必须是原版
- 对应业务 provider 成为 current provider
- 顶部 `当前线路 / Base URL / CLI 变体` 同轮刷新

### 进入改版后

- 顶部 `CLI 变体` 变为改版
- 下方原版业务 provider 不再显示 `使用中`
- 改版按钮变为 `退出使用改版`

### 退出改版后

- 恢复到记录的 `last_original_route / last_original_provider_id`
- 不是按当前面板高亮随意猜测

### 下方 provider 卡切换后

- 顶部状态自动联动刷新
- 但不会切 CLI 变体

### Claude 单独核对

- `settings.json / shell rc / route file` 不一致时可能出现 `sources_conflict`
- 但只作为诊断提示，不再直接影响顶部当前线路和 Base URL 的优先级

## 当前结论

如果只看当前代码，最值得继续统一体验的点不是后端安装链，而是前端顶部状态解释口径。

尤其是 `Claude`：

- 它底层同步保护最强
- 现在已经把顶部显示优先级向 `Codex` 靠齐，`sources_conflict` 只保留为诊断提示

如果后续继续收口，优先级最高的一步就是：

- 保留 Claude 的底层同步保护
- 继续保持顶部显示逻辑按 Codex 的双轴口径工作
