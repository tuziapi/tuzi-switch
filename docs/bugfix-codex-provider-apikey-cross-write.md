# Codex 供应商 API Key 串号问题复盘

## 问题现象

编辑某一个 Codex 官方供应商的 API Key 后，多个供应商卡片展示出的 API Key 变成同一个值。

这个问题属于高风险凭据串号：用户以为只改了一个供应商，实际多个供应商可能读到了同一个运行态 Key。

## 根因

Codex 供应商采用 env-first 凭据模型：

- `settingsConfig.config` 保存 Codex TOML。
- TOML 的 active `model_provider` 段保存 `env_key`。
- `settingsConfig.env.envKey` 保存同一个环境变量名，作为兼容与回显来源。
- 真实 API Key 保存在受管理的环境变量块中。

本次问题来自官方供应商种子配置改动：Codex 官方预设移除了独立 `env_key`，导致多个官方供应商退化到共享 `OPENAI_API_KEY` / legacy auth 路径。编辑任意一个供应商时，保存逻辑写入同一个凭据位置；卡片展示又从同一个位置读回，于是出现“全部变成同一个 Key”。

## 修复原则

Codex 官方供应商必须保持“一张供应商卡片一个独立 envKey”的不变量：

- 兔子线路：`TUZI_CODEX_API_KEY`
- codex 订阅：`CODING_CODEX_API_KEY`
- gaccode：`GAC_CODEX_API_KEY`

种子刷新时可以迁移旧字段里的 Key，但目标结构仍必须恢复独立 envKey，不能把多个供应商合并到 `OPENAI_API_KEY`。

## 本次修复

- 恢复 Codex 官方供应商 TOML 中的 `env_key`。
- 恢复 `settingsConfig.env.envKey`，保证卡片展示、编辑页初始化、保存逻辑使用同一个凭据索引。
- 保留 `env.CODEX_API_KEY` 作为旧数据迁移来源，但只迁移到当前供应商自己的配置中。
- 扩展回归测试，覆盖三个 Codex 官方供应商分别保存不同 Key 后重新 seed 仍互不串号。
- 修复 Codex backfill 时丢失 `[profiles.*]` 的问题，避免供应商切换后 profile override 无法恢复到原 provider id。

## 多 Key 边界

当前设计支持的是“多个供应商卡片，每张卡片一个 API Key”。如果同一个上游供应商需要多个 Key，应创建多个 provider，例如 `tuzi-key-1`、`tuzi-key-2`，让每张卡片拥有独立 envKey。

“一个供应商卡片内部配置多个 Key 池、轮询、熔断”不是本次 bugfix 范围。它需要单独设计数据结构、脱敏展示、失败隔离、并发安全和代理层调度策略，不能混入凭据串号事故修复。

## 经验

1. 凭据字段不能只看“能跑”，必须明确每个 provider 的隔离边界。
2. seed 更新不是纯展示数据刷新，可能覆盖用户配置；所有 seed 迁移都要写回不变量测试。
3. env-first 模型里，`auth.OPENAI_API_KEY` 只能作为兼容来源，不能重新变成多个 provider 的共享目标。
4. live config 是运行态输出，不等同于 provider 的编辑态 SSOT。
5. 修复凭据问题时要优先写多供应商差异化测试，而不是只测单个供应商不丢 Key。

## 验证点

- 三个 Codex 官方供应商分别保存不同 API Key 后，重启或重新 seed 不会串号。
- 缺失 `env_key` 的旧配置会恢复到供应商专属 envKey。
- Codex 切换供应商后，live config 使用正确 token。
- Codex backfill 后，provider 自己的 `model_provider` 和 `[profiles.*]` override 仍可恢复。

## 2026-07-15 补充：live 回填与复制供应商串号

### 新增现象

1. 用户只修改测试线路配置后，切换其他 Codex 线路时，当前 Codex 线路卡片的 Key 被自动改成测试线路 Key。
2. 复制 `codex订阅_2` 后，多个 `copy` 卡片展示同一个脱敏 Key；编辑任一副本会影响同一个凭据位置。

这两个现象都表现为“Key 被覆盖”，但来源不同：

- 切换串号来自 live config backfill 将当前运行态 Key 回写到错误 provider。
- 复制串号来自 duplicate provider 时复用了原 provider 的 `env_key`。

### 根因拆分

#### live backfill 串号

Codex 切换线路后，应用会从 `~/.codex/config.toml` 回填当前 live Key，目的是让卡片展示运行态凭据。

旧逻辑没有严格区分“运行态 live config”和“provider 编辑态 SSOT”：

- live config 里可能包含当前正在使用的 `env_key` 或 `experimental_bearer_token`。
- provider 模板本身也有自己的 `env_key`。
- 当 live envKey 与模板 envKey 不一致时，旧逻辑仍可能把 live token 回填到模板 provider，导致 A 线路显示或保存成 B 线路的 Key。

#### duplicate provider 串号

Codex API Key 使用 env-first 模型，真实 Key 不直接存在卡片配置里，而是通过 `env_key` 指向受管理环境变量。

旧复制逻辑深拷贝了 `settingsConfig`，但没有为新副本生成独立 `env_key`：

- 原 provider：`CODING_CODEX_API_KEY`
- 副本 provider：仍是 `CODING_CODEX_API_KEY`

因此多个副本实际共享同一个环境变量。用户改任意一个副本，本质上都在改同一个 Key。

### 修复原则

1. live config 只能作为当前运行状态参考，不能无条件覆盖 provider 编辑态配置。
2. 回填时必须保留 provider 模板自身的 `env_key`。
3. 如果 live envKey 与模板 envKey 不一致，应丢弃外来的 `experimental_bearer_token`，避免把其他线路 token 固化到当前 provider。
4. 复制 Codex provider 时必须生成新的唯一 `env_key`。
5. 复制出来的新 provider 不应携带原 provider 的真实 Key，也不应携带原 provider 的 `experimental_bearer_token`。

### 本次补充修复

- Codex restore/backfill 保留模板 provider 自身 `env_key`，并在 live envKey 不匹配时移除外来 token。
- duplicate Codex provider 时基于副本名称生成唯一 envKey，例如 `CODEX_2_COPY_CODEX_API_KEY`，冲突时追加编号。
- 副本配置同步更新：
  - `settingsConfig.env.envKey`
  - active `[model_providers.*]` section 的 `env_key`
- 副本配置会清理：
  - `auth.OPENAI_API_KEY`
  - `experimental_bearer_token`

### 回归验证

- live backfill 不应把测试线路 Key 写回当前 Codex provider。
- 切换线路后，provider 自身 TOML 的 `env_key` 保持不变。
- 复制 Codex provider 后，新副本的 `env_key` 不等于原 provider。
- 多次复制同一 Codex provider 后，每个副本的 `env_key` 都唯一。
- 副本初始不应显示原 provider 的 Key；用户后续填写时只写入副本自己的 envKey。
