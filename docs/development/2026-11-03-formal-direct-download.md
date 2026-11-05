# UC-REL-01：正式安装包与公网直接下载

2026-11-03 用户明确要求正式发布、不再标注测试版、点击直接下载 DMG / EXE。此授权覆盖 AiW520/tuzi-switch 的正式 Release、main/tag 推送及 Pages 部署，替代上一轮仅测试预发布的范围；不代表授权合并 tuziapi 正式仓库的 Draft PR。

版本 v1.5.0，高于已核查的上游 v1.4.3 与 fork v1.2.12。使用原 com.tuziswitch.desktop、Windows 既有 upgradeCode、原助手数据目录与真实账户 API；不启用 isolated-profile 或 local-preview。此前独立测试应用的数据不自动搬迁。

下载管线统一到 unified-release.yml：前端/Python、四平台原生回归和构建后，逐平台 manifest 检查 SHA/版本/正式身份/架构、七个安装文件大小及 SHA256，然后上传完整 Release 附件并公开。最后生成 Pages，仅接受公开非预发布版本、固定仓库与七个准确附件 URL/摘要。Mac 两种架构 DMG、Windows EXE/MSI、Linux DEB/RPM/AppImage；不再将 Actions artifact ZIP 作为下载入口。已发布 tag/Release 不覆写；失败可保留旧下载页。

正式渠道更新使用本机 native 身份及语义版本，从该分发仓库的公开 Release 查询完整安装文件，点击时重新确认发布状态，按本机架构直接下载，手动安装。原有启动/定时/恢复联网提醒沿用。旧正式 upstream 更新行为保持，旧测试应用须手动安装本次正式应用，不能假称旧二进制具有新版更新逻辑。

fork 正式构建禁用旧缓存界面热更新加载及下载，避免独立 renderer 覆盖集成 opentu；不删除旧缓存和用户数据。下载页保留 Umami 平台/版本点击事件，仅记录下载点击而非安装完成。

## 质量与范围

仓库未配置开发者签名/Apple 公证，安装系统可能提示发布者验证。用户已明确要求正式版本，不以变更标签掩盖既有质量记录。旧迁移完整性/跨存储回滚、扩展隔离、运行任务退出保护、真实付费业务和跨平台实际安装升级回退仍未完成，本轮不声称已验收。这些限制保留在版本说明及原验收报告中。没有访问真实凭证、付费调用或生产 API 修改。

## 验证及交付

实施中；实际命令结果、云端构建、公开附件与 Pages 验证完成后补录。

本地类型检查、90 文件 / 653 项前端测试、8 项下载元数据/统计桥、4 项安装文件完整性回归通过。宿主 renderer 和下载页生产构建成功；合成版本数据下 1200/390 两种宽度共 14 个安装格式选择、无溢出/页面错误通过，阻断统计与真实下载。尚不属于公网安装文件验证。

## 交付结果

正式安装源码/tag：`v1.5.0` → `1dcb362a514b06ab5ee1cb3e539241ceba0b2655`。随后 `16a958fd0b652b610a3db87d8caa3a9f85f378c0` 仅清理网页预览文案并添加独立网页重试流程，已推送 fork main；未覆写发布 tag 或安装附件。PR #53 已同步，仍为 Draft，未合并正式仓库。

- `Unified desktop release` run `41568675560`：verify 与四个平台 installer job 全部成功，安装文件 manifest/源码/版本/正式身份及 SHA256 验证通过；七种安装文件完整发布到 https://github.com/AiW520/tuzi-switch/releases/tag/v1.5.0 ，draft=false、prerelease=false、latest=v1.5.0。
- 该 run 最后 Pages 部署步骤因 GitHub OIDC ID Token 请求超时失败（权限声明已有 id-token:write），因此不把整条 run 写成成功。独立 `Publish download page` run `41569269087` 从 main 重试并成功，https://aiw520.github.io/tuzi-switch/ 已显示 1.5.0，无测试版/本地预览标签。
- 公网 release.json 与公开正式 Release 的七种资产 URL、大小、SHA256 等逐字段一致。应用浏览器实际切换 Mac ARM/Intel、Windows EXE/MSI、Linux DEB/RPM/AppImage，全部直接指向 v1.5.0 安装文件；用户原标签页已刷新并留在 Mac 下载区域。
- 通过应用浏览器真实下载 `/Users/sdy09/Downloads/tuzi-assistant-macos-arm64.dmg`（24,076,752 bytes），SHA256 `e47af7db1a6923ab2caa046fba20aaf8ae1e519588302464584e0161323e213d` 与 Release 相符。hdiutil verify 通过，只读挂载确认内含 `兔子助手.app`、`com.tuziswitch.desktop`、版本 `1.5.0`、原生 `arm64`；检查后已卸载映像，没有运行应用或改动用户数据。
- 通过应用浏览器真实下载 `/Users/sdy09/Downloads/tuzi-assistant-windows-x64.exe`（20,041,940 bytes），SHA256 `a076f6b871f3315fcd421932877f152cc071e68ae7cc7ba840fa2466e7bc289f` 相符，文件为 MZ 可执行格式；未在 Windows 安装运行。
- 本机 curl 直连 GitHub 二进制下载/HEAD 曾超时，未据此声称七个 HTTP HEAD 全通过；改用浏览器成功取得上述两个真实文件并校验。其他五种格式仅核对公开 Release 元数据、构建 manifest 和页面选择链接，未在本机完整下载或安装。
- 实际客户端 `installerUpdater.ts` 在 Node 环境读取真实公开 GitHub Release：以 1.4.3 为本地版本，四架构正确提示 1.5.0 并选出对应直链；以 1.5.0 为本地版本返回 up-to-date。native opener 使用合成替身，未称作完整原生安装升级验收。
- 本次定向原生热更新测试 5 项通过；确认 PR #54 与 PR #7 仍在祖先链，构建资源包含创作工作区及创作配置。

相关本机证据：`/tmp/tuzi-stable-{tests,native-final,renderer,page-result,public-release,live-page,live-updater-result,dmg-inspection,exe-inspection,publish-failure}.*`。未执行真实账户调用、付费生成或生产 API 修改。签名、公证、完整旧数据迁移与其他既有门禁仍按上述范围记录，不能把公开发布冒充全部用户验收完成。
