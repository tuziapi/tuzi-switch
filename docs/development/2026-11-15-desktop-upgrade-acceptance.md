# UP-03：桌面签名升级与经营分析验收

## 2026-11-16 最新正式更新签名候选核验

候选 `43786133865`（应用源码 `22ae76d26ed88220e30b910b5d1c65884bf3a300`、1.6.2）全量代码检查、四平台构建、正式更新签名及汇总成功。完整 artifact `14192012207` 的 SHA256/ZIP CRC、23 文件摘要、七安装包清单、七更新签名、九目标及精确源码归档独立核验通过。两种 Mac 架构额外确认内置公钥、正式端点、源码 SHA、ad-hoc 代码签名完整性，以及 DMG 和更新归档内所有普通文件一致。这不代表 Apple Developer ID 签名或公证。

证据：[完整归档](evidence/2026-11-16-candidate-43786133865-integrity.json)、[ARM64](evidence/2026-11-16-candidate-43786133865-macos-arm64.json)、[Intel](evidence/2026-11-16-candidate-43786133865-macos-x64.json)。

`signed-candidate-pair.json` base 现绑定此新候选；target 仍是内部 1.6.3 的 `43689683759`，用于验证后续新密钥升级。历史候选的升级结果不能代替本批字节。当前本机安装为同源码本地构建，字节与云端候选分别记录。跨平台新候选实装复验待完成，完整发布门禁仍未通过。

> 2026-11-16 当前状态：用户已授权继续真实付费测试。最新22ae76d2已安装，已完成一次真实生图及ch=3成功结算；画布左上角更新提醒和工具栏避让已实现，最新包分层/OCR、导出、重启及长提示词避让实测尚待完成。986e0884此前的透明像素、5图层中英文OCR、本地缓存、ZIP及重启通过证据仅属于该旧包。正式候选43786133865已获用户签名审批，四平台构建进行中；正式发布门禁仍未通过。详见[逐包真实验收](2026-11-16-latest-package-real-acceptance.md)。下文为历史过程，不作为最新包通过证明。

当前状态补充：用户暂时无法操作电脑，且明确暂不追加付费测试。两次授权提交已用完；供应商传递、旧 Key 回退及预览修复已进入本地收尾，新包实装和真实分层/OCR仍未通过。后续以[最终整合记录](2026-11-15-final-release-readiness.md)中的最新交付状态为准；不再等待用户设置分层参数，不发布。

最新覆盖（2026-11-15 晚）：已整合测试 main 至 `6cfb7f9e`，真实透明生图1次成功、¥0.091、持久消费列表ch=3；详情遗漏来源字段与分层预览破图已隔离修复，分层/OCR第二次提交未得到结果、未重试，窄范围未查到账单但费用未确认。新安装包与签名候选仍待验收。用户已授权验收通过后发布，当前未满足条件。以下旧候选和“0次调用/未授权”均保留为历史时点；准确现状见[最终整合记录](2026-11-15-final-release-readiness.md)。

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

## 正式渠道候选使用受保护测试执行器

`unified-release.yml`新增 `official_candidate` bool（默认false），只允许测试库指定分支；四个构建作业须人工通过 `official-updater-signing` 环境，使用其中的新正式私钥及密码。安装包嵌入正式公钥/正式更新地址，候选不自动发布。构建来源 `repository` 保留实际执行库，新增必填 `releaseRepository` 表示发布渠道；两者不同时必须明确为受保护测试模式。逐包manifest、候选与验收证据同步记录该字段。晋级流程新增有固定选项的 `candidate_repository`，核对正式tag与测试run的同一SHA，并从原始run取得完全相同的安装字节，仍须正式main与完整真实验收。

首轮测试渠道候选run43669383453成功（源码ce7d9ab0），四个平台七个安装包构建、签名与汇总通过，但使用测试密钥且源码较早。首轮原生实验run43669380178：ARM Mac成功；Linux/Windows失败；Intel Mac在第二个版本编译期间达到60分钟被取消，未进入实验，不算通过。后续实验上限增至90分钟，并保留失败构建缓存；不改变编译优化或降低验收检查。修复运行43672875113源码8834834b进行中。

## 构建成功后审查发现打包器不兼容（此候选不可发布）

受保护正式候选 run `43674252720` / `a986a3d03c8d1bd84214e8916d8378b314d6bc2d` 经用户批准后，四平台七包构建、签名和汇总成功。Mac ARM 的完整 artifact 经 GitHub 归档 SHA256 及 ZIP CRC 核验；DMG 摘要、1.6.2 版本/正式应用 ID、架构、新公钥内嵌、正式包不含 QA 入口及 DMG 与更新归档内 4 个文件一致性通过，更新归档已独立验签。其他候选元数据通过逐文件摘要核对；未将选择性下载元数据表述为所有平台安装包均已本机下载。

进一步审阅 Windows/Linux 日志发现五种包均有 `Failed to add bundler type` 警告。锁定的 CLI 2.8.1 仍寻找旧 `.taubndl` 布局，Rust 端 tauri-utils 2.8.3 已使用 `__TAURI_BUNDLE_TYPE_VAR_UNK` 格式；CLI 2.10.1 源码支持新标记。单纯调整 strip 不能解决协议不兼容，因此保留原构建优化，将 CLI 精确固定 2.10.1 并更新 lockfile。构建与实验遇到标记警告即失败，原生实验 started 事件新增 bundleType，并要求实际运行的每个版本识别正确安装类型，禁止依赖默认 NSIS/AppImage 分支冒充全类型验收。该成功候选判定不可发布，详见 [审查记录](evidence/2026-11-15-candidate-43674252720-rejected.json)。

run `43672875113` / `8834834b` 的 Linux 和 Mac ARM 各 8 场景成功，Linux 退出与同安装目录重试修复已复验；但此次没有安装类型断言，不能据此证明 DEB/RPM/MSI 选择正确。Windows 已正确选到安装包，随后因实验隔离校验失败：Windows 规范路径前缀与原始路径比较不一致，且 isolated-profile 仍可能命中旧 HOME 数据库回退。修正为规范路径比较，并仅在非隔离 Windows 版本保留旧目录兼容。原生实验须在兼容 CLI 下重新执行。正式验收记录仍不存在，未发布。

Intel Mac 随后完成该轮 8 场景；该 run 最终因 Windows 失败而失败。修复隔离逻辑后，本机 release/isolated-profile 的原生归因与 HTTP/账户请求联合 24 项通过。测试过滤条件合并为同一次 libtest 调用，已实测多个过滤条件为并集，避免重复链接；不减少测试范围。

CLI 升级后的实验 run `43677933306` / `3ee9f87e` 在 Linux 构建前正确拦截历史依赖不一致：Rust tauri 2.10.3、dialog 2.6.0、updater 2.10.0，对应宿主 JS 仍为 2.8.0、2.4.0、2.9.0。因此取消这一轮剩余作业及仍待审核的正式候选 `43677936778`，不请求或沿用这批签名审批。宿主 JS API 固定 2.10.1、dialog 固定 2.6.0、updater 固定 2.10.0，与 Rust 主/次版本一致；不跳过 CLI 的版本一致性校验。新增构建前兼容检查，与 3 项回归共同覆盖旧 CLI、三个不匹配的 JS 版本及缺失原生插件；签名/门禁/兼容共 16 项通过。后续候选必须基于此完整配对重新构建。

配对更新后本机 99 文件/839 项宿主测试、类型检查、完整 renderer 构建、冻结 lockfile 安装及 actionlint 通过。兼容检查读取实际安装的宿主 JS 包与 Cargo.lock，放在构建前执行。首次 `tauri info` 未在 PATH 找到本机 Rust 工具链，回退显示 Cargo.toml 的旧最低版本；使用已安装 1.95 工具链后确认实际锁定 tauri 2.10.3。正式构建仍以真实 Cargo 元数据及 CLI 版本检查为准。


## 新 CLI 签名调用兼容修复

正式候选 `43679156848` / `485ec1d1a4b4a643ca4bb1cf1f2769832c389b4f` 经用户批准后，全量代码验证通过，但四个平台均在合成签名预检失败，未生成候选安装包。使用临时合成加密密钥复现：CLI 2.10.1 将继承的 `TAURI_SIGNING_PRIVATE_KEY` 解析为内联密钥，与显式 `--private-key-path` 冲突，返回状态2；并非公钥验签不匹配。

签名子进程现移除两个继承的密钥来源变量，只以显式文件参数传入私钥；密码通过环境传递，不放进进程参数，父进程构建环境保持不变。新增真实 CLI 回归验证加密合成密钥签署、独立验签、错误密码拒绝及环境保持。17项签名/发布门禁/兼容检查通过；使用仓库外的新正式加密密钥本机签署合成探针并按正式公钥独立验签通过，未输出凭证。此结果不是安装升级验收。

原生实验 `43679153103` 继续按原源码运行；其独立签名路径未继承构建密钥变量，不因本项修复取消，也不能把它的源码记录替换成后续候选SHA。新的正式候选须重新构建、经过逐次人工保护审核。


## 当前候选与原生实验逐项记录

修复提交 `11b8e308ef77708df3526a7701d106fc04b15f57` 的正式候选 `43680220045` 已通过全量代码检查，用户随后批准受保护环境，四平台均已通过修复后的正式密钥签名预检，安装包构建中。

原生实验 `43679153103` / `485ec1d1a4b4a643ca4bb1cf1f2769832c389b4f` 的 Linux AppImage 八场景通过；下载的 artifact `14148257465` 整体SHA256与GitHub摘要一致，ZIP CRC通过，所有实际启动的旧/新应用均返回 `Some(AppImage)`。成功升级、自动重启、数据保留、失败拒绝与同目录重试均有原生事件记录；仍是临时密钥隔离实验，不是正式候选、DEB或RPM验收。见 [Linux证据](evidence/2026-11-15-native-43679153103-linux.json)。其余任务与平台待验收项统一见 [逐项清单](2026-11-15-desktop-task-checklist.md)，不得以本项通过关闭其他门禁。

Mac ARM随后完成同一run的八场景，artifact `14148173451` 整体SHA256/ZIP CRC通过，所有启动均为 `Some(App)`，升级与重试均记录0.0.1→0.0.2重启和数据保留。见 [Mac ARM证据](evidence/2026-11-15-native-43679153103-macos-arm.json)。

经营分析补验：扩展筛选至 `TestClient(Channel|Source|RequestCounters)`，14项顶层测试通过，包含SQLite合成日志持久化、ch=3筛选统计、迁移幂等/回滚、历史边界与请求计数。显式移除外部数据库DSN环境，1项MySQL/PostgreSQL实库集成按设计跳过，不能将包级PASS表述为该项执行通过。API源码未改；不是生产经营记录验收。见 [完整测试清单](evidence/2026-11-15-api-attribution-regression.json)。


## Windows安装交接超时诊断

run43679153103最终失败：Mac Intel也完成八场景；Windows NSIS前六场景通过，第七场景180秒超时。事件停在下载验签后的install-started，没有新版本启动或终态；第八场景未运行，不能报告Windows通过。Intel与Windows完整证据包摘要/ZIP CRC已核验并归档。

在仅updater-acceptance启用的实验代码中记录Windows真实cleanup_before_exit前后边界，保留清理调用；超时时采集实验进程存活、退出码、执行文件摘要和受限进程清单，不采集凭证、环境或命令行。没有以跳过清理或手动启动新版本代替真实自动重启。新增Windows单平台实验选项，避免重复已通过平台的构建；默认仍覆盖全部四平台。

诊断验证：Python语法、合成子进程/文件诊断执行、两个工作流actionlint及修改文件rustfmt通过。全仓cargo fmt --check发现其他既有文件格式差异，未扩大改动；Windows专属诊断的编译和真实运行由后续Windows实验验证。正式候选43680220045继续按11b8e308构建，不把实验诊断提交冒充该候选源码。

## 正式候选43680220045完整性核验完成

源码11b8e308的verify、四平台安装包与assemble全部成功。四个平台完整artifact均已下载并通过GitHub归档SHA256及ZIP CRC；从这些文件、汇总元数据和本地复现且摘要完全一致的源码归档核对全部23个候选载荷摘要。七直接安装包manifest、七更新载荷的新正式公钥签名、13文件公开白名单及12项公开摘要均通过。汇总ZIP仅选择性读取元数据，未宣称整份汇总ZIP已校验；所有候选载荷逐文件摘要已经核验。

两Mac DMG只读检查确认1.6.2、正式应用ID、正确CPU架构、新公钥和正式更新地址内嵌、无QA入口；各自与签名更新归档的四个文件摘要一致。DEB/RPM解包静态核对实际可执行文件的DEB/RPM安装类型标记、新公钥及正式端点，未执行安装包。四平台日志未再出现安装类型写入警告。见[候选完整性](evidence/2026-11-15-candidate-43680220045-integrity.json)。这不是正式安装升级验收，未生成passing验收JSON，未发布。

## Windows诊断43682932608

源码9d2a60ee的Windows实验再次失败：前六场景通过；第七真实cleanup_before_exit前后事件齐全，旧进程退出码0、已停止，安装目录的可执行文件摘要变化，但没有新版本started事件。第八未执行。证据归档SHA/CRC通过，见[失败记录](evidence/2026-11-15-native-43682932608-windows-failed.json)。据此排除本轮卡在清理阶段；不能仅凭文件变化断言新版本成功启动。

核对CLI2.10.1使用NSIS3.11、nsis_tauri_utils0.5.3的源码：管理员token路径依赖GetShellWindow，缺失Shell时返回失败。新增只在测试库执行的小型环境探针，使用同版本和摘要的工具，实测RunAsUser返回值、直接及重启子进程、参数和合成环境保留，不访问签名Secret、不安装正式应用。诊断成功执行不代表真实升级通过。两个工作流actionlint与diff检查通过；本机无PowerShell，PowerShell运行验证由Windows探针完成。


## Windows重启环境实证与隔离目录恢复

探针43687587858 / 7a8cd233实际确认管理员token与Shell均存在；同版NSIS3.11/助手0.5.3返回0并启动子进程，启动参数保留，但父进程的合成环境变量丢失。直接子进程保留环境，安装器重启子进程不保留；完整归档SHA256/ZIP CRC通过。见[探针证据](evidence/2026-11-15-windows-environment-43687587858.json)。前次探针43686873995因两个makensis候选被拒绝，未完成助手验证，不算通过。

修复仅限updater-acceptance实验构建：Windows启动时从唯一显式参数恢复隔离目录，必须有固定合成标记、场景文件、目录内可执行文件和直属home，已有环境不能冲突；在任何应用存储初始化前执行。标记按固定字节写入，避免Windows文本换行转换。Mac/Linux保留原启动方式，正式包不包含入口。Windows重试移至篡改拒绝后立即进行，保留同安装目录与数据，避免后续场景改变NSIS单一注册安装路径；不重装旧包或手工启动新版。

本机release四项目录校验通过（合法空格路径、缺标记/外部程序、相对路径/缺场景、home符号链接外逃）。Python编译、修改模块格式与工作流静态检查通过。完整Windows升级、自动重启与失败重试仍须云端复验，未标通过；正式候选实装门禁保持未通过。


## MSI、DEB、RPM安装类型补验准备

新增native_upgrade_packages_only/package_installers_only布尔输入（默认false），仅测试库选择MSI、DEB和RPM三个独立作业，输出installerType区分证据，不触发正式签名或发布。系统包实验仅允许GitHub测试库运行；使用QA身份、合成数据和临时签名，原安装器自动重启，不向正式包加入测试入口。

MSI使用真实msiexec，独立场景间卸载已知QA包；签名拒绝后的重试紧接原场景且不重装。DEB在Ubuntu通过真实dpkg和插件提权安装；RPM在Fedora43独立容器中运行真实rpm，检查依赖，不使用--nodeps或伪装包管理器。包管理器场景保留独立home，验证运行时安装类型；清单只提供对应安装类型键，避免通用fallback掩盖选择错误。RPM构建与运行分离，build-only不能记为安装通过。新CLI参数installer/skip-build/build-only分别记录明确边界。

本机Python编译、Shell语法、工作流actionlint及diff检查通过；各系统实装结果待云端运行。NSIS目录恢复复验43688535588仍独立运行，以实际SHA记证据。


## 后续正式密钥升级目标1.6.3

为完成1.6.2→更高版本真实升级，内部目标提交695f4e933d797b39f7a61aad7804800a01eddc96仅将四处应用版本身份统一提升为1.6.3，并增加内部说明。版本一致性与11项门禁/依赖检查通过，测试库正式候选run43689683759固定该SHA；没有创建tag或发布。后续构建仍要求用户逐次批准official-updater-signing。

触发并核对run的固定SHA后，工作分支的四处版本恢复1.6.2，避免把内部升级目标当成首发过渡版。使用普通提交保留全部历史，不重置或强推。正式过渡候选仍为43680220045/11b8e308；新目标的成功构建也不能替代1.6.2原字节实装与实际后续升级证据。


## Windows NSIS完整复验43688535588通过

源码1e46b8e6e5bb99d4559dd6475dda032280a6a471，27项原生回归通过，八项真实NSIS场景全部通过。artifact14151724836完整SHA256与ZIP CRC核验通过。逐项复核运行时Some(Nsis)；升级与同目录重试均有0.0.1→0.0.2、真实cleanup完成、两次profile-restored（原进程false、新进程true）、重启和合成数据保留。签名拒绝与重试使用同一目录，没有重装旧包或手工启动新版。见[完整事件证据](evidence/2026-11-15-native-43688535588-windows.json)。

此结果修复并关闭NSIS隔离实验的环境丢失问题，历史失败不删除。临时测试密钥实验仍不是正式候选验收；MSI/DEB/RPM的43689414375独立运行。用户已批准1.6.3内部目标43689683759的受保护签名，四平台构建中，未发布。

## DEB补验通过与RPM实验恢复修正

43689414375的DEB job132736678007八场景全部通过，artifact14152656698完整SHA256与ZIP CRC及每项事件已独立核验。两次升级均为实际Some(Deb)、0.0.1→0.0.2自动重启和数据保留；签名拒绝与重试共用同一目录。安装失败项实际为已签名的非法包格式被拒绝，不宣称覆盖所有系统安装权限错误。见evidence/2026-11-15-native-43689414375-deb.json。

同run的RPM在interrupted-download场景准备旧包时rpm返回2，随后证据上传因目录权限失败，不能把此前场景当作全部通过。Fedora qa原UID1000与宿主不同，chown后的0700目录不能由宿主runner读取；现使用挂载目录原属主UID创建qa。初始安装失败会输出合成包安装诊断；复位安装补--replacepkgs，真实插件升级仍使用原rpm -U。尚无原RPM stderr，因此同版本冲突仅为待验证原因。原失败记录保留。

新增native_upgrade_rpm_only布尔输入（默认false）及reusable rpm_only（dispatch/call均默认false），仅在native_upgrade_lab_only路径生效；为true时仅运行Fedora RPM，优先于packages/windows筛选。未新增业务字段、契约或数据库字段。

## 原字节正式签名Windows实装子集

signed_candidate_windows_only新增布尔输入，默认false。只在测试仓库启用独立NSIS/MSI jobs，互斥其他候选/签名/发布任务。固定下载43680220045（1.6.2，11b8e308）与已批准43689683759（1.6.3，695f4e93）的verified-release；要求run成功、精确SHA、工作流身份、全部文件摘要与正式公钥签名匹配。不重编应用，不访问私钥，无新签名审批。

一次性Windows runner安装原始候选字节，合成HTTPS发现映射仅在runner内；临时TLS证书和hosts映射于finally恢复。应用和WebView2出站防火墙限制为loopback，不携带CI token。通过实际WebView2 UI点击下载、拒绝篡改/中断/404、同安装目录重试、重启更新；仅初次手工启动1.6.2，必须由安装器启动1.6.3。原生IPC核查版本、ID、正式渠道、源码commit，核对SQLite合成供应商和WebView偏好保留。清理失败同样判失败，报告不上传TLS私钥或原环境。

脚本只产出real-installed-app-subset且officialAcceptance=false；尚不覆盖旧正式版手动过渡、有效安装包系统安装失败、完整创作项目迁移、经营归因或全平台审阅。语法、Python编译、shell语法、actionlint与diff检查通过；Windows实际结果待运行。无新增应用持久化字段，无发布。

Windows原字节首跑43691893665：两候选完整归档摘要、文件摘要及正式签名检查通过，但初始化合成TLS环境时旧powershell.exe未加载Cert驱动，安装尚未开始。改用与workflow一致的pwsh并显式加载Microsoft.PowerShell.Security，避免PowerShell 7→Node→Windows PowerShell 5.1继承PSModulePath的模块混用。该失败不算安装升级通过，不修改或重签候选。

复跑43692079099已解决Cert驱动加载，继续发现CurrentUser Root导入会要求交互信任UI，在非交互runner返回“UI is not allowed”。仅在受限一次性runner中改用LocalMachine Root，并同步精确thumbprint清理；未降低应用TLS验证、未修改候选。仍未开始安装，保留失败run。

43692245944继续在启动应用前拒绝原防火墙地址前缀，TLS初始化已通过。改用显式IPv4/IPv6地址范围排除loopback与不可路由的未指定/广播地址；保持出站隔离，规则创建失败即不启动应用。此类环境初始化失败均不计入产品安装升级结果。

43692488079：环境初始化、NSIS/MSI初始真实安装均成功（安装器返回0且原位置可执行文件存在），但连接1.6.2 WebView超时，尚未核对运行身份或升级。下一轮增加CDP最后错误、已见页面URL、仅应用/WebView进程信息及干净runner的启动日志诊断，不据此直接判定产品启动失败或通过。合成TLS和防火墙已能成功创建；完整results还记录了恢复空WebView环境值时的清理错误，不能宣称清理全部通过。

读取43692488079完整证据后确认实际应用已访问本地Release API与更新清单，连接失败不等于应用没启动。修正空原环境恢复逻辑，并让各清理步骤独立执行，单步失败不跳过后续hosts/防火墙/证书恢复；任何清理错误仍使子集失败。1.6.3源码归档本地复现SHA256为262fe0970daa8d5a8070a556810cc4d5781c770ff03033166c22ad79e8f612b9，与候选完全一致。

## RPM复验43691829983通过

Fedora43真实rpm实验八场景通过；artifact14153490733归档SHA256/ZIP CRC、每次启动Some(Rpm)、两次0.0.1→0.0.2自动重启、数据保留以及签名拒绝后同目录重试均已独立核对。见evidence/2026-11-15-native-43691829983-rpm.json。修复已解决实验恢复及证据采集阻断，历史失败保留；仍为临时密钥实验，正式包验收独立。

43693103081诊断确认正式1.6.2正常显示主窗口且已访问更新信息，但127.0.0.1:9222拒绝连接。增加IPv4/localhost/IPv6 loopback连接及调试监听/参数的精确诊断，避免把自动化连接问题误记为应用启动失败。

43693664668：三个loopback地址都拒绝连接；进程诊断显示WebView2未收到调试参数且9222没有监听。应用正常显示窗口，清理已无错误。依据Microsoft WebView2 CreateCoreWebView2EnvironmentWithOptions文档，追加仅针对com.tuziswitch.desktop/tu-zi-switch.exe的临时AdditionalBrowserArguments注册表覆盖，保留并恢复原值；只使用remote-debugging-port，入站也阻断非loopback。无需修改正式候选或禁用TLS；后续实跑验证能否连接。

43694284150的临时注册表覆盖生效，已通过实际IPC读取1.6.2正式ID、stable渠道、正式仓库与11b8e308精确commit。随后“View update”被首次欢迎弹窗挡住；已人工查看failure.png，补充正常点击Got it/我知道了，保留真实UI操作，不强制穿透遮罩。升级尚未开始，继续复验。

## 正式签名Windows原字节升级子集43694716475通过

测试源码82c03942，NSIS/MSI两个job全部成功。分别完整下载artifact14154057482与14154007800，归档SHA256、ZIP CRC及10项断言独立复核通过：真实应用拒绝篡改包、截断下载与404，随后同安装目录重试；下载验签、安装、由安装器自动重启、版本/ID/正式渠道/精确commit及SQLite合成供应商与WebView偏好保留均通过。旧进程实际exit0，无手工启动1.6.3，临时环境清理无错误。两个格式分别实际请求.exe/.msi载荷，没有用NSIS替代MSI。已查看重启后截图。

固定候选为43680220045/11b8e308的1.6.2与43689683759/695f4e93的1.6.3，测试过程中未重编、重签或修改安装包；仅版本发现为本地合成HTTPS。完整证据见evidence/2026-11-15-signed-43694716475-nsis.json与evidence/2026-11-15-signed-43694716475-msi.json。保持officialAcceptance=false：旧正式版手动过渡、有效包安装失败、完整创作项目迁移、经营归因及其他平台正式实装尚未完成。

MSI临时密钥实验43689414375 attempt1于08:27:20 UTC自行失败，取消请求到达前已结束；GitHub annotation明确“hosted runner lost communication with the server”，job日志和artifact未留存，不能推断产品安装失败原因。仅重跑该MSI job，attempt2为132753425896；未重复DEB/RPM。

## 正式1.6.3完整候选独立核验

完整下载verified-release artifact14152951863（339235181字节），续传完成后校验整体SHA256 48685ace6b6f0398dd1d4dce9f5e7e97185d82ae1ecec770c47151e2ba496e50、ZIP CRC、23个候选文件摘要、七个手动安装文件的四平台manifest、七个新正式公钥签名、九个更新目标及源码归档复现，全部通过。见evidence/2026-11-15-candidate-43689683759-integrity.json。该1.6.3仅作已批准的内部升级目标，未发布。

## 旧正式版手动过渡补验准备

新增signed_candidate_windows_manual_transition布尔输入（默认false），仅signed_candidate_windows_only路径传入reusable manual_transition（默认false）。开启后下载正式已发布v1.6.0的Windows两包和manifest，固定manifest SHA256 ab7eb20f36407dfa80631f855cf68633f7876ee5b7b72b930326579c15ec6599、正式commit21cad50c及安装包摘要；只读正式Release，不修改线上附件。

在一次性runner先真实安装/启动1.6.0、通过普通IPC保存合成供应商和WebView偏好，关闭托盘最小化选项后走正常窗口退出；要求原进程exit0。再用真实1.6.2安装器手动过渡，核查精确身份和原数据保留，不重新种入fixture；随后继续既有1.6.2→1.6.3正式签名升级及三种失败重试。仍不手工启动1.6.3。仅新增测试选项和LEGACY_INSTALLER_DIR测试环境变量，无业务/数据库字段。node语法、actionlint、diff检查通过，真实结果待运行。

## Windows旧版手动过渡及签名升级43695838168通过

测试源码beeb7e4485f69a8249056ea46c7edfa9e3b034aa，NSIS/MSI两个job成功。独立下载artifact14153354402（NSIS）和14153999896（MSI），归档SHA256/ZIP CRC、11项checks、三代运行时版本/应用ID/stable渠道/精确commit与请求格式全部复核通过。1.6.0正常退出码0，真实1.6.2手动安装保留此前SQLite合成供应商和WebView偏好；随后1.6.2通过正式签名下载、安装器自动重启到1.6.3，原进程exit0。全程没有重种fixture或手动启动1.6.3，三类下载失败及同目录重试继续通过，清理无错误。已查看实际重启后截图。

证据见evidence/2026-11-15-signed-43695838168-nsis.json与evidence/2026-11-15-signed-43695838168-msi.json。该结果补齐Windows旧用户手动过渡路径的安装/基础数据子集；完整创作项目、多媒体、有效安装包的系统安装失败、生产经营统计和Mac/Linux正式包仍未验收，officialAcceptance继续为false，没有正式发布。

## 正式Windows创作持久化补验准备

扩展同一Windows正式原字节流程：旧1.6.0通过普通创作配置与Seedream4.5菜单生成合成图片，验证真实队列/IndexedDB/媒体像素，手动过渡后核对原画板、元素和任务；1.6.2通过Seedream5.5普通菜单执行透明PNG、生图、三图层及OCR，再在自动重启的1.6.3核对全部元素/图层/OCR元数据、任务与缓存像素。没有直接写入项目数据库或替换IPC函数。

仅在一次性runner将api.tu-zi.com映射到本机HTTPS合成服务，沿用外网阻断和证书/hosts恢复。真实原生请求必须携带合成鉴权；1.6.2模型路径要求唯一ch=3，模型列表不能携带消费归因。合成响应只覆盖请求、持久化及展示，不声称供应商质量/生产账单通过。新增仅测试报告字段与脚本，无应用持久字段或产品接口变化。真实结果待运行；完整项目格式迁移及生产经营门禁继续保留。

创作补验43696737861（a8204b71）两格式均在升级后的像素定位超时。完整artifact与failure.png确认：真实旧版图片手动过渡、1.6.2生图/透明PNG/三层OCR、正式签名自动升级及元素/元数据/任务比对已经执行；分层应用会替换源图片，测试仍查找已被替换的源元素ID，属于测试定位错误。修正为检查快照中实际保留的图层ID，不放宽像素、数据或签名断言。同时合成服务补齐不带鉴权的公开/api/status探针，此前误将它计入模型鉴权错误；模型路由继续严格检查合成Key及唯一ch=3，模型列表与状态探针无消费归因。历史失败不删除，复验待运行。

## Linux正式包实装控制通路预检准备

新增signed_candidate_linux_probe_only（bool，默认false），单独调用signed-candidate-linux.yml，Windows/实验/签名/构建/汇总路径均跳过。只读取已批准1.6.2候选原字节，复核run/SHA/manifest摘要/正式签名后用系统dpkg安装DEB；独立一次性tuziqa用户阻断全部非loopback IPv4/IPv6请求，通过WebKitWebDriver读取实际UI和原生版本/应用ID/源码。无重编、重签、付费/生产请求；验证Linux正式包后续自动化控制通路，不等同升级通过。报告明确officialAcceptance=false。新增测试输入、reusable调用与默认值均补齐，actionlint、Python语法及diff检查通过，真实预检待运行。

Linux预检43698634342已验证正式候选摘要/签名并由dpkg成功安装1.6.2；尚未启动应用，独立用户不能穿过runner私有工作目录读取脚本，且继承了runner的XDG_RUNTIME_DIR。改为只复制测试脚本到独立/tmp目录，并为tuziqa创建0700运行目录；不放开runner目录或读取其凭证。补显式安装DEB声明的libappindicator3-1，避免依赖runner预装状态。原失败保留，未记UI/原生身份通过。

43699005552在apt准备阶段失败：libayatana-appindicator3-1与libappindicator3-1互斥；首轮已经证明Ayatana包可满足本候选dpkg依赖，不能同时显式安装两者。恢复只安装Ayatana实现，保留独立用户路径与运行目录修正；未改候选包或绕过dpkg依赖检查。

## MSI八场景attempt2及Windows创作升级子集独立核验

MSI run43689414375 attempt2/job132753425896成功；artifact14155520289完整归档SHA256/ZIP CRC、八项终态、Some(Msi)、两次0.0.1→0.0.2自动重启、数据保留与同安装目录失败重试已核对。临时密钥七种格式实验现均通过；MSI的install-failure是已签无效二进制格式拒绝，不是有效包的系统安装失败，不能替代该正式门禁。见evidence/2026-11-15-native-43689414375-msi.json。

Windows run43697704283/f68b3735两格式15项断言、完整归档SHA256/ZIP CRC、三代运行身份、正式签名与实际自动重启独立核验通过。旧1.6.0通过真实UI/原生HTTP生成的画板/图片/任务在1.6.2手动过渡后保留；1.6.2真实Seedream5.5菜单执行透明PNG及三层OCR，1.6.3自动重启后元素/OCR/未知字段/任务/缓存像素保留。原生模型请求唯一ch=3，模型列表无ch；旧1.6.0实测ch=0，证明此前桌面消费归因确有缺口。供应商仅本机合成HTTPS，无生产消费或付费调用。见evidence/2026-11-15-signed-43697704283-nsis.json与-msi.json。

截图额外审查发现：快速分层替换源图后，原生成占位卡可能永久停留“正在加载结果”。数据和像素断言通过不覆盖该显示问题，已在两份证据reviewObservations保留。源码定位为新图层未继承已有generationTaskId/generationAnchorId，导致占位控制器找不到已完成的结果；新增真实Plait变换回归在修复前失败，原构建的浏览器回归也实际复现。此问题修复后必须重建签署候选并重新验收，当前旧候选不能直接发布。

Linux预检43699354264已在独立用户正常启动正式1.6.2主窗口（原生日志可核对），但WebDriver建立会话返回HTTP500，尚未读取运行身份或执行升级。完整artifact14155134192已下载并验证归档SHA256/ZIP CRC。补充保存本地WebDriver结构化错误响应，继续定位控制通路；不因启动日志存在就标记升级通过。

Linux43699772576的结构化错误为session not created / Failed to match capabilities。核对Tauri官方crates/tauri-driver/src/server.rs，Linux仅传webkitgtk:browserOptions，不强制MiniBrowser品牌。修正测试参数并等待真实文档加载后再读IPC，无候选应用修改。

分层占位修复正式候选已启动run43699923173，固定源码5bfee5f39b0b370093081227c6e19883f21280a0、版本1.6.2；旧候选43680220045的通过证据保留但不作为修复后验证。Windows后续测试已将base run/SHA及下载输入统一更新到本次候选，并增加完成占位清理的明确断言；须等该run全量校验、用户逐次签名审核、构建及独立验签完成后才运行，不使用测试密钥替代。内部1.6.3升级目标保持原已批准字节，仅用于升级测试，不作为本次最终发布包。

Linux控制通路43700222624/a40c2b31通过，artifact14155848597已完整下载并核对SHA256/ZIP CRC；实际原生IPC为1.6.2/com.tuziswitch.desktop/stable/tuziapi仓库/11b8e308精确源码，真实DOM含opentu创作与欢迎弹窗。见evidence/2026-11-15-linux-probe-43700222624.json。仅证明原字节DEB实装、启动与可控IPC，不包含升级。截图发现最小runner缺CJK字体、日志缺update-desktop-database，不能算视觉或深链验收；补充测试机fonts-noto-cjk、desktop-file-utils和AT-SPI基础包再采集，不改应用包。

修复候选43699923173/5bfee5f3的verify已成功，四平台目前等待official-updater-signing；已向用户说明新增修复需逐次审批，不能沿用旧run批准。仍无正式发布。


## Linux 实装预检字体补齐与修复候选审批

用户已批准修复候选 `43699923173`（`5bfee5f39b0b370093081227c6e19883f21280a0`）的受保护环境，四平台已实际开始构建，未发布。

Linux 预检 `43700641638` / `9db60abdff83e0bcc95441d56bf1dc06aa2609be` 成功。证据归档 `14156118378` 的整体 SHA256 `32788f8fe0160c0eeaf07df72930863aa4f7e0450c1a7ca750bae531ad614a84` 与 ZIP CRC 独立通过；原生身份仍匹配原候选 `43680220045`。人工查看截图确认补齐 Noto CJK 字体后欢迎弹窗及导航中文正常。仅记录实际安装、启动、原生 IPC 和有限截图观察；不当作完整视觉、深链、创作或升级验收，也不替代修复候选测试。

## 修复候选的 Linux DEB 正式升级复验准备

保留已有调用参数 `signed_candidate_linux_probe_only=true`，测试范围扩展为安装预检加正式 DEB 更新子集，默认仍为 false，其他构建/发布分支继续跳过。固定来源为修复候选43699923173与内部目标43689683759；先独立验证两份候选运行身份、全部摘要与DEB签名，再安装原字节。尚未执行通过，不填写验收 passed。

新增 `signed-linux-upgrade.py` 只允许测试仓库 hosted Linux runner 以root运行控制器；实际应用为独立非特权用户，IPv4/IPv6阻断非loopback，清空继承环境以避免XDG路径落到runner账户。测试使用本机合成TLS/发现服务与实际签名包；下载篡改/中断/404、有效包系统权限拒绝、同目录重新下载和真实dpkg安装均通过应用界面触发。失败后仅对一次性用户授权真实dpkg临时包命令，不改应用/安装器、不替代IPC。新进程须由应用自己启动，控制器只按继承的WebKit inspector地址重新连接，不能手动启动冒充自动重启。真实创作迁移、旧正式版手动过渡、经营统计仍为独立未验收项。

本地Python语法检查和Actions actionlint通过。补查上一轮probe日志发现继承的XDG变量令xdg-mime尝试访问runner目录并被拒绝；记录为测试环境问题，下一轮已改为干净环境，上一轮仍不计深链验收。

## 补齐当前公开 1.6.1 的手动过渡来源

只读核查正式仓库最新公开版本仍为 v1.6.1（2026-11-11 10:16:25 UTC 发布）。旧实测来自1.6.0，不能覆盖1.6.1的具体兼容性，因此Windows手动过渡矩阵扩展为 NSIS/MSI × 1.6.0/1.6.1，后续签名目标保持1.6.3。下载的1.6.1 manifest整体SHA256为`d53747e8c479ebad6cadba2046627f871d59f12c2696521a787f0d723d16a19f`，源码为`7c13bc943a4b7116af15593ec0ac18af0ba9727f`，EXE/MSI摘要随manifest固定；运行时身份仍必须匹配，不把builder SHA冒充源码。新增测试环境变量LEGACY_VERSION由固定矩阵传入，不接受未登记版本；默认手动测试关闭时仅单组执行。归档名增加来源版本避免矩阵覆盖。旧版的实际ch值只记录，修复版必须唯一ch=3。尚未实测通过，语法和actionlint已通过。

## 修复候选构建成功与 Windows 四组正式原字节复验

候选 `43699923173` / `5bfee5f39b0b370093081227c6e19883f21280a0` 的verify、四平台构建、更新签名及assemble全部成功。Mac Intel独立归档`14156947019`整体SHA256/ZIP CRC通过；DMG与更新归档内4个普通文件逐字节一致，架构x86_64、正式公钥/更新地址及隔离QA入口缺席核验通过，不计Mac实际升级验收。

Windows测试 `43703529198` / `c7344dd1c9ee2e0578a9f9113846625cc67274c5` 的 NSIS/MSI × 1.6.0/1.6.1 四组均成功。四份归档完整SHA256/ZIP CRC、每组16项断言、三代运行身份和可执行文件变化均独立核查；旧进程正常exit0，无清理错误。确认旧版生成数据经手动过渡保留，修复候选通过正式更新签名自动启动1.6.3；生图、透明像素、三图层/OCR/未知字段、任务及缓存像素在升级后保留。已逐张查看四份升级后创作截图，原先残留的生成占位卡不再出现；持久化数据也没有generation-anchor。

真实原生HTTP合成记录再次确认：1.6.0和1.6.1都是ch=0，修复1.6.2的两类模型请求均唯一ch=3。此次仍是合成供应商，不等于真实模型质量、付费业务或生产经营统计已验收。内部1.6.3仅作为升级目标，不作为包含本轮修复的最终发行包。证据为`evidence/2026-11-15-signed-43703529198-{nsis,msi}-{160,161}.json`，均保持officialAcceptance=false；不能替代剩余跨平台与业务门禁。

Linux首次正式更新测试 `43703533350` 已保留失败证据：修复候选安装/身份正确，但合成本机GitHub发现响应缺少CORS头，页面没有进入native manifest或下载。补齐与Windows测试服务一致的CORS及OPTIONS后，以`43704088017`重新验证；不修改安装包、不重新签名。首次诊断截图超时也保留，不计任何视觉或升级通过。

## 修复候选独立完整性与 Linux DEB 真正安装失败/重试通过

完整归档`14156419801`（339383390字节）SHA256为`dcadbadebe1fa385657b66bbd90358946a06342f0ffc517d94b14d30fd722aa5`，本机整体摘要与ZIP CRC通过。23文件、7个直接安装包、7份更新签名、9个更新目标、13个手动过渡公开文件白名单和精确源码归档重现全部核对；两种Mac架构DMG与更新归档内4个普通文件一致，正式公钥/端点正确，正式包不含隔离QA入口。这里只是静态核验，不计Mac实际升级通过。

Linux `43704088017`补CORS后仍未进入native下载，保留失败结果。随后测试服务改用独立受信CA与CA:FALSE服务器证书，保持原生TLS验证；截图改为实际X显示抓取。第三轮 `43704616672` / `5b520ae7cc9ec132876eb39d23d930c92202ad0c` 成功：归档`14158515875`的整体SHA256 `8230a57ac39b7f5a04826d9d7a1ffd275acd6370a2c80dd5ba939d1d28572e55`、ZIP CRC、11项检查均独立核对。实际日志含sudo权限拒绝；之后同目录重新下载原签名包、真实dpkg安装，版本成为1.6.3，PID从5074变为5257。测试只重新连接继承的WebKit inspector，没有手动启动目标应用；SQLite供应商与WebView偏好保留。已查看权限失败和自动重启后的实际屏幕截图。未覆盖公开旧版手动过渡、创作项目迁移与真实经营记录；通用安装错误包含条件式Mac DMG提示，作为文案限制留存。

扩展AppImage的`43705166840`在前置DEB预检截图阶段超时，两组都没进入升级，不能记成AppImage安装失败。已把预检同样改为实际X显示抓取，`43705658951`继续跑DEB/AppImage以及独立Fedora43 RPM。新增脚本参数installer默认deb，可选appimage/rpm；AppImage使用真实权限受限目录和原包精确摘要，RPM使用真实依赖数据库、不用nodeps，应用仍为阻断外网的非特权用户。共享校验脚本在运行前验证固定的两份候选身份、全部23文件和三个Linux签名。语法/actionlint通过；新增格式未有通过结果前保持未验收。


## Linux 三格式正式原字节升级独立复验通过

43705658951/fa0fa0d8的DEB、AppImage升级各11项通过，RPM在原生身份读取后的进程定位失败，cleanup又缺pkill；整体run失败，两个成功job的结果仍独立保留。修正测试控制器的有效UID/解析后可执行路径识别，为一次性Fedora容器增加SYS_PTRACE及procps-ng后，43706229636/bf622e3417227ed8fb328a862446f85a3d7987f5三个格式全部通过。没有更改、重编或重签应用包。

独立下载完整artifact：DEB14158696345（628a8fb045ee1ae08f1f2ba67724bc9a612805416fe03185b641d5b35690ae76）、AppImage14157778609（c679843dbed8c1466d38dacb277fcac2e8c3b8511d9ddcb9be5d70eaafcd45d9）、RPM14157698894（b2edd502d09ff160bb58d61fed7da9a7c82c2fc3b488056002a613c551cb503d）；归档SHA256、ZIP CRC、11项终态、精确两代源码/身份、实际载荷路径及不同重启PID均复核。AppImage整体前后摘要等于两份候选原包；DEB/RPM包管理器最终1.6.3。有效签名包先真实权限拒绝，随后同目录重新下载、验签、安装与自动重启；未手动启动目标应用。

已查看三种格式自动重启截图和AppImage/RPM权限拒绝截图。最小Fedora日志暴露缺xdg-mime，深链注册未通过；另有缺桌面服务/硬件的容器警告。不能将升级子集通过解释为完整Fedora桌面、深链或多媒体功能通过。跨平台旧公开版过渡、创作数据和真实供应商/经营统计门禁继续保留。证据见evidence/2026-11-15-linux-signed-43706229636-{deb,appimage,rpm}.json及前轮失败记录。

## Mac 两架构原包实装/已有权限通过与正式升级补验

43706075287/8ca9172b的ARM与Intel两组原字节DMG安装、匹配CPU架构、codesign完整性、真实主窗口启动、已有Accessibility权限和AX树均通过；两份完整归档SHA/CRC独立核验，截图均已查看。未授予TCC权限；仅清理SIGTERM，不算正常退出或升级通过。

后续测试源码e68cb404新增signed-macos-upgrade.py，既有signed_candidate_macos_probe_only输入（默认false）扩展为原字节签名升级子集。固定两份已批准候选，不重新签名。以用户已有AX权限操作普通更新按钮，临时本机TLS/hosts用于版本发现，原应用与自行重启子进程继承仅loopback网络沙箱；结束恢复hosts和临时CA。实际签名下载、三类下载失败、同目录重试、正常退出、自动重启、目标app全部文件与签名归档逐字节相等、欢迎确认保留均须独立断言。没有修改正式安装包、启用调试构建、绕过TCC或手动启动升级目标。

Python、Node语法、actionlint、沙箱profile语法及diff检查通过。run43706872126已启动，真实结果未到前不记通过。此子集仍不覆盖有效包系统安装失败、旧版手动过渡、原生IPC运行身份及完整创作迁移。


## 已复现的 Linux 依赖与安装失败提示修正（待重建候选）

正式RPM在最小Fedora实际启动时缺xdg-mime，证明不能依赖桌面环境预装。src-tauri/tauri.conf.json为DEB/RPM显式增加xdg-utils；已核对当前tauri-cli-v2.10.1的interface/rust.rs，显式depends会与自动GTK/WebKit依赖合并，不会覆盖默认运行库。现有Linux升级权限失败截图也显示Mac专用DMG提示；updateSession复用已有isMac检测，其他平台改为检查目录写权限/系统安装授权后重新下载，不改变安装状态机或重试行为。

15项更新检查/状态机定向测试、宿主类型检查和diff检查通过。首次tauri info因当前shell缺Rust工具链PATH误读Cargo.toml最低版本；显式使用已安装1.95工具链后确认锁定tauri2.10.3与JS2.10.1配对，配置可解析，无依赖变更。独立Python JSON Schema验证器未安装，未冒称该验证通过；已检查CLI自带schema中两个depends的string[]类型。没有新增应用数据字段或迁移。

这两项改变最终应用/打包配置，因此43699923173的证据只适用于原候选；最终发行候选必须重新构建、由用户逐次批准正式签名并复验，不能沿用旧包通过结论。当前仍未发布。


## Linux六组旧版过渡与Mac失败追加核对

43707335991 / 559edc6f809064ddca65e688a9578a93d7ef34b4的AppImage/DEB/RPM × 旧1.6.0/1.6.1六组各12项通过。官方旧manifest、实际旧包、三代运行时身份、三个不同PID、配置/WebView保留、失败后重试及正式自动重启均独立核对。只在旧版种入合成配置，后续不重种；旧版正常窗口关闭仅观察进程消失，未取得退出码。仍未覆盖Linux创作数据迁移和完整多媒体。六份证据归档SHA/CRC通过，截图已查看但部分含入场动画。

Mac43706872126两架构已在欢迎按钮查找失败，后因清理命令挂起取消；43707701973两架构同处失败且清理30秒超时。43708121050的Intel使用求值后的AX列表后成功关闭欢迎页；15秒更新toast在实际点击前消失，截图/AX树仍有常驻New version available: 1.6.3按钮。实际尚未下载目标载荷。ARM仍排队。每轮失败保留，不把测试控制失败误报成签名安装失败或通过。

后续测试使用已观察到的常驻更新入口；临时CA信任清理改为导出admin trust、仅去掉本轮指纹、导入保留其余条目的快照并再次导出比对，证书按精确指纹删除；全部只在一次性runner执行，超时或恢复不一致仍判失败。测试改动不修改正式候选字节，真实复验待运行。

新正式内部候选43708139009 / ee807c0365d90b34687adbe3b4e8ccd1b2c16777已通过全量校验，等待official-updater-signing用户审核。仅内部构建签署，未发布；最终新包必须重新实装核验。

## Mac 双架构升级本体通过，测试信任清理失败

43709169781 / f4acbb46 的 ARM 及 Intel 均通过10项升级本体检查：真实UI拒绝篡改/中断/404，正式原字节下载验签、安装、旧进程exit0、自动重启1.6.3、欢迎偏好及同目录重试。实际安装文件与本地独立验签归档精确一致，归档SHA/CRC和重启截图已核对。两job最终failure，原因是admin trust import超时，不能标记workflow成功。证据以-cleanup-failed.json保留。

43708890897的Intel在读取系统账户导出的信任文件时权限失败，尚未启动app；证据已归档。其ARM及上一轮43708121050的ARM均在排队时取消，不是实际执行失败。

后续测试环境撤销方式仅针对本轮临时CA：设置无条件deny，导出核对其他admin trust条目完全一致；系统curl在同一个本机TLS服务上须先成功，撤销后须以证书校验码60失败，不能用断网冒充撤销。删除精确证书和临时私钥、恢复hosts、停止服务。拒绝记录明确保留到GitHub销毁一次性runner，不宣称恢复了空记录；不改变签名/安装/重启断言。复验待执行。

43709812487两架构再次完成10项升级本体检查。撤销命令和导出都正常，但测试误把Security框架的序列化字段写成result；已核对本机SDK的SecTrustSettings.h第186行，正确名称为kSecTrustSettingsResult，Deny枚举值为3。此次仍按job失败保留，不冒称TLS撤销负向检查已执行。

Windows新增待验场景：正式载荷完成验签后，仅对测试进程专用TEMP/TMP目录拒绝CreateDirectories，先证明同身份真实创建被OS拒绝，再通过普通UI安装并检查错误、原版本/字节保留。恢复精确ACL后重新下载并继续自动升级。不触碰用户目录或生产凭证；异常清理也恢复ACL。此项仅覆盖安装器准备阶段的OS权限失败，不替代外部NSIS/MSI安装器启动后的失败与回退，后者仍未验收。Node语法及diff检查通过，实际运行待最终候选。

## Mac正式原字节升级43710290201双架构通过

测试源码0f73d9623c68c748325c6c1c84aede7228d12b05；ARM及Intel两个job与workflow均success。归档14159738466/14160441784的SHA256及ZIP CRC、各10项checks、旧进程exit0、不同重启PID、三种失败载荷路由与两代实际安装文件均独立核验通过。所有普通文件精确等于本地已核验的正式签名归档；两张自动重启截图已查看，无手工启动目标进程。

同一个本机HTTPS服务在临时CA撤销前由系统curl成功访问，设置deny后返回证书校验失败60；导出确认其他管理员信任条目完全保留。精确证书和临时私钥删除，hosts恢复，服务器停止。仅本轮无条件deny记录保留到一次性runner销毁，未宣称空记录恢复。清理无错误，此前各轮失败证据仍保留。

这证明旧候选43699923173/5bfee5f3的1.6.2至内部43689683759/695f4e93的1.6.3签名升级子集。没有真实模型调用，Mac旧公开版手动过渡、有效包权限拒绝、原生IPC身份及创作迁移仍未验收；officialAcceptance为false。最终新候选43708139009/ee807c03仍等待用户签名审核，不能以本轮旧包通过替代。未发布。
