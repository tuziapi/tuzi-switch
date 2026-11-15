# UP-03：桌面签名升级与经营分析验收

日期：2026-11-15（Asia/Shanghai）。用户选择基于正式发行源码完成整条更新流程，补充要求核查 API 项目的经营分析，并允许在测试库进行测试操作。正式发布仍以真实验收通过及发布授权为前提。

## 基线与工作区

- 正式仓库 main：`ca378b869422b18f7b11c72b735ee8990dfb6a8b`；公开 v1.6.1 的安装包源码：`7c13bc943a4b7116af15593ec0ac18af0ba9727f`。只读 GitHub API 核查：公开附件没有 `latest.json` 或 `.sig`。
- 独立分支 `codex/verified-desktop-updates`。原 `/Users/sdy09/Documents/tuzi-switch` 的 gaizhao 及34项既有改动保持不动。
- API：`/Users/sdy09/Documents/New tuai API`，HEAD `28443ae853a24165b23638a8b98d3ad96ddba4f0`，只有既有未跟踪 output/；本轮只读及合成单元测试，不修改 API，不访问生产数据库、不发付费模型请求。
- 测试仓库 `AiW520/tuzi-switch` 的原有 `TUZI_UPDATER_PRIVATE_KEY` 与正式仓库的密钥不同。测试库签名配对成功不能证明正式安装包公钥能接受该签名，不能将正式公钥替换为测试公钥。正式签名上次 run 42974023945 的 check 注释为 GitHub 计费锁定，作业未启动。

## 实现

1. 统一构建流水线只生成签名候选包；push tag 也不再自动发布。候选文件记录仓库、源码 SHA、run、版本及每个文件 SHA256。缺密钥/签名/平台产物继续失败。
2. 独立 `promote-desktop-release.yml` 只接受正式 main 上的人工触发，核对候选 run、tag、源码、签名和每个已测试文件的 SHA256；从原 run 下载候选文件，绝不重新打包被测试的安装包。版本必须严格递增，不重写已发布版本。
3. 发布必须有 `docs/development/update-acceptance/v<version>.json` 的已审阅真实验收记录。四个平台均要求从较旧版本安装升级，包含下载、签名、安装、重启、版本、数据保留、坏包、网络故障、安装失败、重试和经营归因。合成 UI、单元、构建成功、临时测试密钥的原生实验均不能代填 passed。
4. 原来正式应用中可由命令行直接绕过交互触发安装的验证入口移入 `updater-acceptance` feature（依赖 isolated-profile），并要求固定 QA 应用身份、独立 home、loopback 地址。正式构建不包含该入口。
5. 新 `native-upgrade-lab.py` 构建0.0.1/0.0.2两个隔离应用，使用临时测试签名，通过真实插件下载、验签、替换与重启。验证真实应用数据库中的合成供应商及外部合成文件保留；失败场景校验旧可执行文件哈希不变。结果为原生实验，不是正式候选包验收。

## 经营分析核查与修复

API 的 `middleware/client_channel.go` 在鉴权前捕获且移除唯一合法的 `ch=1/2/3`；`model/log.go` 写入消费来源，`model/client_channel.go` 将3显示为“OpenTu 桌面正式版”，经营来源统计已有去重/历史边界等测试。

桌面嵌入源码虽保留网页归因工具，但桌面构建未设置其原独立客户端证明，账户桥接又仅传 action、重建 URL，导致参数丢失。现在在最终原生 HTTP 出口统一补齐：正式仓库的 release 非隔离构建为3；测试仓库、debug与隔离包为0。手动配置只处理已知兔子 API 节点的模型路径；账户路径按已受控模型路由处理。移除所有旧 ch（含编码形式），保留其他查询字节、请求体和认证 Header。不改第三方、媒体资源、模型列表和余额查询地址。媒体路由由已有 catalog 补齐，防止新增适配器漏标。

Umami 页面/操作统计仍保留，属于尽力上报，不等于 API 经营/消费记录。本轮无生产统计入库证据，不将本地测试表述为线上经营数据已验收。已有渠道字段被复用；没有新增数据库列、账户持久字段或权限。

## 新字段与兼容

- CI `native_upgrade_lab_only`：bool，默认false；仅测试库调用隔离实验，其他构建/发布跳过。
- 原 `signing_preflight_only`：默认false；扩展到两仓各自现有公私钥配对，互不复制凭证；不得与正式发布组合。
- 原 `publish` 输入移除，发布改用独立流程的必填 `tag`、`candidate_run_id`。旧手工命令必须更新，不能绕过验收。
- candidate/evidence `schemaVersion=1`；仓库、commit、runId、tag、files 必须全部填写并与候选相同；证据另含 status、signingKey、reviewer、completedAt及四平台记录。缺失/待验收即拒绝。
- `updater-acceptance` 默认关闭；QA应用标识 `com.tuziswitch.desktop.update-qa`，工具 home 与真实安装分离，临时私钥不提交或上传。

## 验证记录（持续更新）

- 宿主全量：99文件839测试通过；类型检查、完整 renderer 构建通过。
- 候选绑定与签名脚本：10测试通过。首次 node:test 文件被 Vitest 扫描而产生1个空suite，改为独立 verify 脚本命名后完整重跑通过。
- API `go test ./middleware ./model -run 'TestClient(Channel|Source)' -count=1` 通过，仅本机合成数据。
- 原生构建、实装实验、测试库四平台流程及签名配对：执行中，结果后续追加；正式密钥、正式旧包到候选包、四平台正式验收及发布均未完成。

## 回退

源码可通过独立提交 revert；不改变已发布文件或密钥。回退发布门禁将失去真实验收约束，不能作为发布本任务候选包的捷径。旧版硬编码手动更新的客户端仍需一次手动安装过渡版；服务器清单无法远程修改旧二进制。
