# UP-03 / SD55-01 最新包真实付费验收

## 授权与包身份

2026-11-16用户明确要求直接进行付费测试，不再以原两次/¥5限制阻塞，对最新安装包实测。继续使用已确认的奶酪配置。发布仍须完整验收通过；未发布、未改正式下载页。左上角更新提醒尚未修改，不列入本包已完成功能。

从已核验DMG安装源码21a8429c97168aade4475ce209a6608ac234e01c/1.6.2 Mac ARM64，正常退出旧版、备份后替换，包内源码再次核对，未修改用户配置存储。旧应用保存于 `/Users/sdy09/Documents/tuzi-switch-artifacts/installed-real-20261116/pre-install/兔子助手.app`。启动后5个旧项目均在，旧测试原图恢复。

## 已真实执行

- 08:16上海时间：对旧测试原图执行Seedream5.5，1K、前景2、OCR，总返回3张；原图预览修复在新包正常显示，真实OCR读出TUZI 55，应用到画布成功；切换项目后3个图层及分组恢复。消费请求202611160016272686358238268d9d6U3jZ6qRR，quota220000，ch=3，settled/charged/applied。
- 08:20：新建独立项目执行同模型透明生图，1K/1:1/PNG/1张，文字TUZI 16与新版验收正常。原生保存成功，1024×1024 RGBA，806071全透明、19847半透明、222658不透明像素。SHA256：485c2f79e2ad9b0a572cfe84c2938d8e8647cbda77caef8122f26ab7af2c366b。请求202611160020271772146018268d9d6QRa2UCXi，quota65000，ch=3，settled/charged/applied。
- 新项目命名为“1.6.2 最新包真实验收 11月16日”，与旧分层测试项目分别保存，当前共6个项目。

本轮两次模型提交均成功。UI和消费列表来源已确认；API单笔详情Ch映射修复仍未部署，不据列表成功认定线上全部经营界面完成。

## 实测导出问题与修复

分层ZIP导出实际报No files available to download。只读检查该测试画布：图层仍指向带签名的服务商CDN URL，浏览器可显示但fetch读取被跨域拦截。独立桌面的缓存IPC不属于集成宿主能力，回退的WebView fetch同样不能取到原始字节。

复用已有requestManual原生HTTP读取输出媒体，只发GET、omit credentials、no-referrer，不带账户或模型Key；保留取消、原生响应大小和拒绝重定向约束。分层缓存优先该宿主能力，ZIP及原图保存也复用无凭证媒体读取，支持既有远程图层再次导出。未新增持久字段或原生权限。

新增3项回归在修复前均失败（缓存返回远程URL、原图读取失败、ZIP无文件），修复后连同既有图片/缓存/下载测试78项通过。源码修复仍须重建安装后对真实图层复验，不用单元测试替代实机导出通过。

修复后创作全量163文件/2715项通过，宿主pnpm typecheck通过（不覆盖全部上游TS）；来源补丁1640文件逐字节还原通过。日志为/tmp/tuzi-native-media-creative-all.log、/tmp/tuzi-native-media-typecheck.log、/tmp/tuzi-native-media-provenance.log。
