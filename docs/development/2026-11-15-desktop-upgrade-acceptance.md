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
3. 发布必须有 `docs/development/update-acceptance/v<version>.json` 的已审阅真实验收记录。四个平台及其全部安装类型（macOS app、Windows NSIS/MSI、Linux AppImage/DEB/RPM）均要求从较旧版本安装升级，包含下载、签名、安装、重启、版本、数据保留、坏包、网络故障、安装失败、重试和经营归因。合成 UI、单元、构建成功、临时测试密钥的原生实验均不能代填 passed。
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
- candidate/evidence `schemaVersion=1`；仓库、commit、runId、tag、files 必须全部填写并与候选相同；证据另含 status、signingKey、reviewer、completedAt及四平台记录；每个平台必须补齐 installers 数组，包含该平台全部 type、status、evidence、checks。缺失/待验收即拒绝。
- `updater-acceptance` 默认关闭；QA应用标识 `com.tuziswitch.desktop.update-qa`，工具 home 与真实安装分离，临时私钥不提交或上传。

## 验证记录（持续更新）

- 宿主全量：99文件839测试通过；类型检查、完整 renderer 构建通过。
- 候选绑定与签名脚本：11测试通过（含逐安装类型漏验拒绝）。首次 node:test 文件被 Vitest 扫描而产生1个空suite，改为独立 verify 脚本命名后完整重跑通过。
- API `go test ./middleware ./model -run 'TestClient(Channel|Source)' -count=1` 通过，仅本机合成数据。
- 原生构建、实装实验、测试库四平台流程及签名配对：执行中，结果后续追加；正式密钥、正式旧包到候选包、四平台正式验收及发布均未完成。

## 回退

源码可通过独立提交 revert；不改变已发布文件或密钥。回退发布门禁将失去真实验收约束，不能作为发布本任务候选包的捷径。旧版硬编码手动更新的客户端仍需一次手动安装过渡版；服务器清单无法远程修改旧二进制。

## 首轮本机结果与候选版本

- 候选版本设置为1.6.2，package/Tauri/Cargo/Cargo.lock同步；直接编辑版本，不执行会自动推送的npm version/postversion，不创建正式tag。
- 本机 macOS ARM64 完整原生应用8场景通过：签名篡改拒绝、下载中断、下载404、验签成功但归档损坏拒绝、同版本、降级、0.0.1→0.0.2下载验签/安装/自动重启/数据保留，以及验签失败后在同一安装目录重试成功。证据见 [本机实验](evidence/2026-11-15-native-upgrade-macos.json)。该构建为实现过程中的隔离应用，不是正式候选字节验收。
- 正式release编译配置的原生归因6项、手动HTTP6项、账户原生HTTP/媒体13项通过（筛选有交集，不合并计数）。账户请求在真实本机HTTP服务端断言唯一ch=3，手动请求同时核对字节体和认证Header不变。
- 测试库run `43668308038` 成功，使用其现有Secret实际签署合成探针并通过该库现有公钥验证，10项签名/候选校验通过；没有读取/替换正式私钥。
- 四平台首轮实验在补充下载中断/同安装重试与编译缓存复用后主动取消，随后只在更新后的测试分支重跑。取消的run不算通过。

- 补充收紧：Windows/Linux 实验按版本精确选择安装包，避免共享构建目录的新旧包混选；正式验收门禁逐项要求 NSIS/MSI 和 AppImage/DEB/RPM，不能以单一安装格式代表整个平台。当前隔离实验仅覆盖 NSIS/AppImage，不宣称另三种安装格式通过。

## 操作入口（替代旧 publish 参数）

以下仅为测试仓库操作；分支须先推送并核对远端 SHA：

```sh
# 使用测试仓库现有密钥验证配对
gh workflow run unified-release.yml -R AiW520/tuzi-switch --ref codex/verified-desktop-updates -f signing_preflight_only=true
# 隔离应用的原生升级实验
gh workflow run unified-release.yml -R AiW520/tuzi-switch --ref codex/verified-desktop-updates -f native_upgrade_lab_only=true
# 常规候选：全部测试、四平台构建、逐包签名与汇总；不会发布
gh workflow run unified-release.yml -R AiW520/tuzi-switch --ref codex/verified-desktop-updates
```

签名预检、原生实验和候选构建各自独立；不能用某一个 run 的成功代替另一个。下载候选使用该成功 run 的 `verified-release` artifact，保留其中 `candidate.json`、原签名及所有文件字节。

正式晋级流程尚未授权执行。未来正式候选验收完成后，审阅记录必须从对应候选抄录 schemaVersion/repository/commit/runId/tag/files，并填齐真实 reviewer/completedAt、existing-channel-key 配对证据、四平台及全部安装类型的检查结果和证据位置；不能用临时密钥实验或本页汇总生成 passed。将记录审阅合入正式 main，tag 指向该候选源码，再用 `promote-desktop-release.yml` 的 `tag` 和 `candidate_run_id` 晋级同一批文件。旧文档出现的 `-f publish=true/false` 是历史命令，已不适用于本实现。

## 测试执行器中的受保护正式签名环境

2026-11-15 用户选择在测试库配置受保护的正式签名环境。已创建 `AiW520/tuzi-switch` 的 `official-updater-signing`（环境 ID `27339917740`）：只允许分支 `codex/verified-desktop-updates`、必需审核人 AiW520、禁止管理员绕过；因当前唯一指定审核人也是仓库拥有者，允许该用户人工审核自己的运行。本任务不自动批准环境部署。

新增 `official-updater-preflight.yml` 的测试库作业使用上述环境，只签署并验证合成探针，不上传私钥或签署安装包，不发布。正式公钥 SHA256 固定为 `4563ca397f2a4d652b21c046a659ff2149b7537278e70b564263d688164fa7f1`（来源 ca378b86），禁止替换测试公钥。现有常规候选仍使用测试库自己的密钥，不能因此视作正式签名候选。

环境 Secrets 需密钥管理员从原始保管处设置 `OFFICIAL_UPDATER_PRIVATE_KEY`，有密码时设置 `OFFICIAL_UPDATER_PRIVATE_KEY_PASSWORD`。创建时核对 Secrets 数量为0；GitHub 已保存的 Secret 不能通过 API 读回，本任务未读取、复制或生成新的正式私钥。若原私钥无法找回，新密钥仅可用于另行确认的手动过渡安装方案，不能将其冒充旧公钥配对成功。

## 合入 PR #73 的本地实现

按用户新增指示合入会话“同步 PR #73 最新实现”的 `51681502a2ef640adb5b63793a5e2c375c23ea18`，其中正式 PR #73 为 `6cf7201f51de5f7abf447cd9f15f45b18d8af979`。业务代码无合并冲突；开发入口、进度两处文档冲突保留双方记录。该会话已另行将原目录同步到 51681502；本任务继续使用独立 worktree，不回写或覆盖原目录。

合并后的本轮验证：创作模块156文件2614项、宿主99文件839项、类型检查和完整renderer构建均通过。上述仍为本机合成回归；正在执行的较早云端run源码是ce7d9ab0，不宣称包含PR #73。用户随后批准另行补齐Seedream 5.5全部能力及更换正式密钥，后续最终源码须重新验证。

## 用户批准新正式密钥与手动过渡（覆盖旧密钥保留决定）

用户明确回复“没有备份，创建新的正式密钥并采用一次手动过渡安装”，并选择先完成自动更新签名、不办理平台代码签名。已生成独立的新正式更新密钥（不是测试库现有密钥），本机加密私钥/密码备份位于仓库外 `~/.tuzi-signing/official-updater-20261115-uthwgmmr/`，目录0700、私钥及密码0600。两项凭证通过标准输入直接写入受保护环境 Secrets，未输出、提交或放入日志。

新公钥 SHA256：`8118379cd76c3f4be522498e732856efd5b1a56aed12f0e50a1155993e7d0fb5`；本机已使用新私钥实际签署合成探针并通过新公钥验证。旧公钥及备份缺失原因保留在 `scripts/updater-key-transition.json`，首个过渡版本为1.6.2。不得将此次结果称为旧公钥配对成功。受保护云端预检和手动过渡的发布门禁仍继续实施/验证，未发布。

新增策略字段 schemaVersion/repository/firstVersion/delivery/oldPublicKeySha256/publicKeySha256/authorizedAt/reason 全部填写；它是构建/交付策略，不是账户或数据库字段。过渡版安装包将携带新公钥，旧版需一次手动安装；不得向旧公钥客户端宣称可直接自动升级。

## 新密钥云端通过与过渡门禁（2026-11-15）

用户人工批准受保护环境后，run `43671613743`（源码 `f6e942ed2dc4b009471e2191e80e18bbe7bb17ae`）成功，使用新正式密钥签署合成探针并验签。不是旧密钥恢复，也不是正式安装包验收。

候选/证据 schemaVersion 更新为2，新增必填 `delivery`、`publicKeySha256`、`publicationFiles`。正式1.6.2由策略自动判定 `manual-key-transition`；仅公开七个直接安装包、来源清单、源码及其SHA256SUMS，不公开latest.json、.sig或app.tar.gz。候选内部仍保留全部签名供核验。发布逐字节复制白名单文件，拒绝草稿中残留的额外附件；以后的版本恢复正常签名清单发布。测试库自身渠道仍使用既有测试密钥。

过渡验收必须使用 `new-official-channel-key`，逐平台/安装类型填写旧版→1.6.2 `method=manual-install` 及安装/重启/版本/数据/归因检查，并分别提供 `signedUpgrade`：真实1.6.2→更高版本，绑定新公钥摘要、目标包SHA256、源码commit与全部故障/重试检查。后续新密钥自动升级没有实测时，门禁仍拒绝发布。不生成虚假的正式通过记录。

首轮云端源码ce7d9ab0：Mac ARM64实验成功，Windows因新旧安装包混选失败（0505b136已修正）；Linux前7场景成功，第8重试未启动。下载事件/进程日志表明升级重启后的新进程退出卡在窗口状态保存，并拦截下一次单实例启动。将窗口状态保存移回事件循环线程，避免窗口状态缓存锁与跨线程窗口查询互相等待；实验新增进程PID记录及真正退出检查，保留首次/重试两份日志。修复结果以新运行另记，原失败不改写成通过。
