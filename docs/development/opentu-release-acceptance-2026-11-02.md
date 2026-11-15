# UC-AC-R1：统一客户端上线验收

日期：2026-11-02（Asia/Shanghai）。**结论：不通过公开上线验收；可以继续内部预览。** 界面、单元测试和合成请求通过，不代表全部创作功能、真实供应商和安装升级通过。未推送、创建 PR、发布或操作生产数据。

## 基线与范围

- 客户端分支 `codex/opentu-assistant-sync`，HEAD `71314a670b4cca0e1aaf2b2af3295b4fca6d8ad8`，基于用户指定的 `codex/assistant-main-sync`。集成改动仍在本地工作区，HEAD 不包含全部待验收改动。
- PR #7 的 `f9183a33` 在 HEAD 祖先链内，本轮再次核验通过；没有重复合并。
- opentu 固定来源 `7d05f299fec40599221294a34c9b26f888177c9e`。1359 个原文件哈希核验，82 个原文件有集成补丁，6 个本地文件；补丁重建逐字节一致。
- 本轮补丁 SHA-256：`655e5e3395682e44543ea994ea885189183c1ef3e67ec8177b20956bf7b33b83`。
- 只使用隔离浏览器、临时原生 home、合成凭证和合成图片响应。未读取真实账户秘密，未调用付费模型。未更改 API 服务端或 `system-token-v1` 契约。

## 本轮发现和修复

| 问题 | 修复 | 复验范围 |
|---|---|---|
| 深色生成工具仍有浅色底、文字对比不协调 | 八个工具样式用宿主主题变量，保留独立版原值；补齐模型测试和播放器半透明白底 | 两种主题、1180×800 / 900×600；40 个内部工具打开状态 |
| 离开创作页卸载执行器，返回画布只剩“正在显影” | 任务执行与当前账户传输留在宿主生命周期；画布仍卸载；返回立即启动结果恢复 | 留在画布、助手页面、项目列表、另一项目四条成功链，图片解码与 IndexedDB 结果检查 |
| 后台结果可能插入当前其他项目 | 有生成锚点的任务只在原锚点所在画板交付 | 另一项目保持无生成图片，回到原项目插入一次；刷新后保留 |
| 外部工具空白，Chat-MJ 被引导去配置 Key | 按用户选择，三个入口改走系统浏览器；仅传固定工具 ID，宿主解析固定公开 URL；旧画布入口显示浏览器按钮 | 12 个主题/窗口组合的模拟 IPC 交接；6 个边界用例；无 iframe、无 Key 设置窗口 |
| URL 模板可能把模型 Key/账户引用交给外站 | 宿主模式不再从供应商读取 `apiKey` 作外部 URL 替换 | 固定外链参数测试；此项不等于任意自定义扩展隔离已完成 |
| 覆盖恢复的确认点击会关闭外层备份弹窗 | 确认弹窗存在时保留外层弹窗，防止外部点击关闭打断导入 | 通过真实 UI 点击确认，再收到损坏文件拒绝提示 |
| 导入边清空边解析，且项目写失败可能只记日志 | ZIP CRC、JSON/画板结构、已声明 checksum、项目计数和不安全路径先校验；分片禁止逐片覆盖；项目写失败上报失败 | 9 个预检测试；损坏覆盖保留项目；合并两次不重复创建；**尚无多存储事务回滚** |

本轮只新增临时接口属性 `active?: boolean`（默认 true）和 `openExternalTool?: (toolId) => Promise<void>`（缺失则明确报错）。没有新增持久化字段、数据库迁移或账户凭证类型；旧备份缺少可选校验字段仍可读取，有声明则必须匹配。

## 逐项验收矩阵

依据 `opentu-unified-client-design.md` 的 UC-AC-01～12。部分通过不计为上线通过。

| 编号 | 状态 | 已有证据 | 剩余门槛 |
|---|---|---|---|
| 01 全新安装 | 部分 | macOS ARM 独立调试包可构建；历史隔离启动及实际导航记录 | 正式签名安装包、干净机器运行、Windows/Linux |
| 02 原助手升级 | 部分 | 598 项前端、1480 项原生单元、2 项独立 MCP 服务测试；PR #7 已包含 | 从已发布正式版升级的完整数据/工具回归 |
| 03 完整创作 | 部分 | 24 个常规页面、40 个内部工具打开状态；5 条合成图片任务链、3 条备份链 | 音乐、视频、MV、多图、模型巡检等完整业务；原生文件/媒体端到端 |
| 04 主题/弹层 | 局部通过 | 52 个弹层状态；浅深色和两个窗口尺寸；账户配置复验 | 真实多显示器、全屏/缩放、全量键盘/语言路径 |
| 05 生成期间切页 | 合成图片通过 | 离开助手/进入项目列表不中断；其他项目不被修改；返回/刷新图片解码成功 | 原生实际请求，视频/音频/批量任务和全部生成入口 |
| 06 切号与失效 | 部分 | 受管来源边界单元、配置 UI；桥接随宿主账户变化更新 | 原生 UI 切号时在途任务、真实账户失效/权限变化 |
| 07 未知结果 | 合成图片通过 | 失败场景只一次 POST；刷新不补发；原生取消测试 | 进程强退、不同供应商异步查询与轮询恢复 |
| 08 导入失败 | 未通过完整门禁 | 损坏 JSON/缺失项目/校验不符/路径异常预检；损坏覆盖保留数据 | 配额满、权限失败、写入中断后跨数据库/缓存回滚 |
| 09 导入完整性 | 未通过完整门禁 | 简单 ZIP 导出恢复、二次合并项目 ID 幂等 | 旧 opentu 原生媒体目录、完整图/视频/知识库引用、缺图、分片和中断日志 |
| 10 凭证/扩展 | 未通过完整门禁 | 默认备份不含合成明文 Key；3 个固定外站不传 Key；账户传输边界测试 | 自定义工具导入、历史嵌入内容和同源脚本的完整权限隔离 |
| 11 更新/回退 | 未通过 | 单一宿主 updater 结构；未触发更新安装 | 原生退出/重启运行中任务保护、签名验证、失败恢复与回退实测 |
| 12 性能/平台 | 未通过 | 本机 ARM 开发环境构建与浏览器检查 | Windows/Linux、正式包性能基线、冷启动/内存/大项目压力 |

## 必须关闭的上线阻塞项

1. **原生退出/更新任务保护。** `src-tauri/src/lib.rs` 的关闭及主动退出路径会进入进程退出，重启请求另行放行；浏览器 `beforeunload` 不是该原生链路的完整保护。需要覆盖窗口关闭、托盘退出、更新重启、在途生成状态落盘及下次恢复。
2. **旧数据迁移和导入事务。** `backup-import-service.ts` 仍对环境、素材、项目、知识库、任务逐域写入，校验通过后的磁盘/配额失败仍可能部分成功。需实现 staging/journal、提交与回滚、媒体引用及幂等完整性验证；旧原生数据迁移不能由简单 ZIP 回归替代。
3. **自定义扩展边界。** `toolbox-service.ts#importTools` 未走完整工具定义校验；普通 URL 校验仅对 `startsWith('http')` 分支处理；旧工具元素仍可能采用 scripts + same-origin。三个固定外站改为浏览器不解决任意自定义工具的边界。此处是源码审计缺口，未声称已利用绕过 CSP/原生权限。
4. **真实与完整业务验证。** 多图/视频/MV/音乐/模型巡检目前验证了窗口显示，不能据此称成功生成。合成图片的 native IPC mock 不代表真实付费供应商或原生 UI 全链通过；真实调用需另行授权。
5. **正式交付验证。** 三平台安装、旧版升级、签名、更新失败、回退、大项目性能和用户验收未完成。

## 命令、结果和证据

| 层次 | 命令/脚本 | 结果 |
|---|---|---|
| 全量前端 | `pnpm exec vitest run --maxWorkers=2 --minWorkers=1` | 84 文件、598 项通过 |
| 原生单元 | `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1` | 1480 通过、4 忽略 |
| 独立原生 MCP | `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib services::mcp::native_integration_tests:: -- --ignored --test-threads=1` | 2 通过，补跑上项中两条；另两条需已安装 CLI / Go 配对环境，未补跑 |
| 类型 | `pnpm typecheck` | 通过 |
| 图像任务 | `tests/visual/creative-generation-acceptance.cjs` | 5/5；每例 POST=1，刷新后 POST=0；成功例只插入一次且可解码 |
| 备份 UI | `tests/visual/creative-backup-acceptance.cjs` | 3/3：明文 Key 排除、合并两次、损坏覆盖拒绝 |
| 工具清单 | `tests/visual/creative-tools-acceptance.cjs` | 52 状态：原轮知识库一项等待超时，知识库四状态独立复验全通过；12 个外站交接通过 |
| 弹层 | `tests/visual/creative-overlays-smoke.cjs` | 52 状态通过 |
| 常规页面 | `tests/visual/creative-pages-smoke.cjs` | 24 状态通过 |
| 账户配置 | `tests/visual/creative-account-smoke.cjs` | 通过，含账户/手动保存重载、取消草稿、模型发现和禁用 Key |
| 补丁/规格 | 原文件哈希、补丁应用后字节比对；OpenSpec strict | 通过 |

初次全量前端出现一项 5 秒超时，单独 App 23 项复验通过；后来一轮与包重建重叠导致模块入口暂时缺失，23 项 App 测试失败。停止构建竞争后全量 598 项通过。工具知识库也保留首次超时和复验记录，没有把失败日志删除或直接标成通过。备份脚本曾把导出后自动关闭误判为应恢复按钮，修正等待条件后重跑通过。

本轮主要日志：`/tmp/opentu-release-{frontend-verified,rust,mcp-isolated,types-verified,generation,backup,tools-final,knowledge-recheck,overlays,pages,account,provenance,openspec,native-build}.log`。

浏览器产物目录：`/tmp/opentu-release-{generation,backup,tools-final,knowledge-recheck,overlays,pages,account}/`。截图来自 Chrome 合成 UI，不能标注为原生 WebView 截图。备份 ZIP 和图像均是本轮合成测试数据。

## 本轮原生构建与实际窗口复核

完整 `pnpm tauri build --debug --features local-preview --bundles app --config src-tauri/tauri.preview.conf.json --config src-tauri/tauri.creative-preview.conf.json` 通过，包含创作包、宿主 renderer 和原生构建。macOS ARM 调试产物为 `src-tauri/target/debug/bundle/macos/兔子助手.app`，bundle ID `com.tuziswitch.desktop.creative.preview`，已重新启动。

实际 macOS Accessibility 点击通过：兔子助手 → opentu 创作 → 创作配置 → 手动配置 → 保存并获取模型 → 关闭设置 → 自由画布。测试原生应用连接 `127.0.0.1` 随机端口的合成 HTTP 服务，服务收到一次 `GET /v1/models`，验证合成 Bearer 正确；原生模型弹窗实际显示 `SYNTHETIC-native-image-check`。这是实际 WebView → 宿主 IPC → 本机 HTTP → 模型弹窗验证，超出浏览器 mock，但不是公网模型调用。未点击生成，未产生费用。

测试配置保存在既有隔离 home 中，供应商标为 `SYNTHETIC native acceptance`。本机合成 HTTP 服务已停止，测试 app 留在自由画布。没有改动日常应用配置。原生证据为 `/tmp/opentu-release-native-{launch.log,settings-ax.txt,models-ax.txt,canvas-ax.txt,http-events.jsonl}`。

浏览器截图不能替代原生截图；本轮通过原生 Accessibility 和合成 HTTP 记录核实，没有将 Chrome 图片称作原生截图。调试 app 不等于已签名发布包。


## UC-DL-01 后续核查

下载页工作前复核了上述日志与结果 JSON，并再次确认 PR #7 祖先关系。没有改动客户端代码、没有重跑或扩大上述测试的结论。下载页作为独立本地评审成果完成，明确区分预览与稳定版；退出/迁移/扩展隔离/完整业务/正式三平台门禁仍未通过，不能据此上线。详见 progress.md 的 UC-DL-01。
