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
