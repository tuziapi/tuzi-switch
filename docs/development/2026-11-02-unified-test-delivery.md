# UC-TEST-01：统一客户端测试交付（2026-11-02）

用户已明确批准更新 AiW520/tuzi-switch 测试仓库 main、构建未签名安装包与下载页、向 tuziapi/tuzi-switch 提交 Draft PR。此授权覆盖历史文档中的本地限制；不包含正式发布、合并、API 仓库推送或网站部署。

## 集成与兼容

基线 71314a670b4cca0e1aaf2b2af3295b4fca6d8ad8 已包含 PR #7。本次合入正式 main 857c4e328f10453b8410658af461611662d02171，保留 MCP 聚合读锁和便携 Pi 禁用删除修复，merge 提交 d30d2b17。测试 main 原为 a7c22dfe75ee025a2a53c9c097325bf319316de8，更新前保存远程备份分支，以指定旧 SHA 的 force-with-lease 更新。

opentu 来源固定为 7d05f299fec40599221294a34c9b26f888177c9e，1359 原始文件哈希与补丁还原一致；82 文件有集成改动，6 本地新增。独立工作流入口/专用实现已移除，原画布内部任务队列保留。账户契约仍为 system-token-v1，无 API/数据库契约变更。新增配置字段默认值、旧配置兼容、来源校验与模型协议边界见账户关联实施记录，不自动迁移或删除旧数据。

## 交付

- `acceptance-build.yml` 仅在测试 fork 的 main/gaizhao 或手动触发；不会创建 Release、发布标签或部署网站。
- 测试应用名 `Tuzi Assistant Test`，应用标识 `com.tuziswitch.desktop.acceptance`，独立 Windows upgradeCode 和 `tuziswitch-test` 协议，不提供自动更新。编译启用 `isolated-profile`，默认工具配置与账户记录使用独立 acceptance 数据目录；不启用仅限 debug 的 `local-preview`，账户仍使用正式协议/地址，不带本机模拟账户。用户显式设置的目录覆盖仍有效。
- CI 分别构建 macOS ARM/x64、Windows x64、Linux x64，上传安装包、精确 commit、SHA-256；未签名/未公证，保留 30 天。构建成功不等于安装、升级、回退验收完成。
- `packages/download-page` 是独立 AGPL-3.0-or-later 网站包，保留 new-api / QuantumNous 来源；桌面许可不变。构建时验证正式仓库公开 Release 资产，提供版本快照和发布记录入口；另提供当前 Actions 的测试包入口。站点 artifact 包含完整源码归档与校验清单，不自动部署。
- 主按钮“下载兔子助手”，品牌复用 `src-tauri/icons/icon.png` 蓝兔原始字节。Umami 仅统计实际下载点击和 platform/version，不能用于证明下载完成或独立人数。网站共享组件同改于独立 API worktree，未推送 API。

## 本次验证

本机 macOS ARM：创作包/宿主 renderer/下载页构建和类型检查通过；84 文件 598 前端测试通过；1482 原生单元通过、4 忽略，其中 2 个隔离 MCP 服务测试单独补跑。另 2 项依赖外部配对环境，不冒充通过。Python 内置技能 3 项通过，OpenSpec 严格验证通过。

下载页完整 18 浏览器场景通过；网站共享版与独立静态版分别验证 1440/390 宽度、3 个蓝兔资源、主按钮、无横向溢出和无页面脚本错误。测试阻断生产统计。先前完整生成/备份/弹窗证据见 UC-AC-R1，本次未将历史结果冒充重跑。

暂存 1453 文件（含 vendored 上游）检查未发现真实凭证特征、dist/node_modules 或大于 5 MiB 文件。上游保留文件及来源补丁有既有空白格式告警，为保持来源可重建不整批重排。

## 尚未通过的正式发布门禁

1. 原生退出/重启时的进行中任务保护。
2. 旧桌面媒体/数据完整迁移、跨存储导入失败回滚。
3. 自定义扩展验证与隔离；三个固定外部工具已按用户选择走系统浏览器且不传 Key。
4. 全部多媒体业务与真实供应商端到端验收。
5. 三平台安装/升级/签名/回退和性能验收。

因此 PR 保持 Draft，测试产物不可认定为已验收正式版本。回退测试 main 可从保留分支恢复；正式仓库未合并，不需生产数据回退。


云端首轮 41401808218：verify 与下载页成功；两个 macOS 在创作包构建触发约 2 GiB 的 V8 默认堆上限（SIGABRT/134）。为构建任务明确设置 4 GiB Node 堆，测试与正式构建配置同步修复；未修改业务源码或开启正式发布。后续构建结果以新提交 Actions 为准。


第二轮 41402848454：四平台前端及原生常规检查通过后，安装包 release 编译触发原有 local-preview 仅限 debug 的编译保护。保留保护，拆分 isolated-profile 功能；它只负责独立数据目录及工具路径隔离，local-preview 依赖该功能并继续独占本机模拟账户。新增特征回归校验正式账户协议、独立目录和拒绝模拟令牌，CI 在构建前执行。
