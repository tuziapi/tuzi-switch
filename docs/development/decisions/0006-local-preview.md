# ADR-006：隔离本地预览

日期：2026-10-14；对应 T19 的本机交互预览子集。用户授权补齐本地配置/环境并查看效果；不扩展产品范围，不授权发布。基线 B3 / desktop-v1.1 / desktop-v1 不变。

## 决定

- Rust 显式 `local-preview` feature 固定账户 origin 为 `http://127.0.0.1:5180`，client 为已受支持的 `tuzi-switch-desktop-test`。开启该 feature 的非 debug 构建直接编译失败。无前端传入 origin，无任意 URL 环境变量，默认生产构建继续使用原地址/client。
- macOS 独立 bundle ID `com.tuziswitch.desktop.preview`、名称保持“兔子助手”，保留协议规定的 `tuziswitch://auth/callback`。本地配置 home 指向独立应用数据目录；OAuth 继续使用系统安全存储，按 origin/client 分命名空间。初始化待授权记录也使用实际 origin/client，避免中途重启误报 storage_invalid。
- API 复用显式 opt-in Go fixture 模式，使用独立目录内持久 SQLite 和会话密钥，首次初始化合成账户/余额/密钥/日志/模型，重启保留用户测试操作。加载原完整 API 与 Dashboard 路由，网站和助手共用数据；不读取 .env 或连接外部数据库，不启动正式后台任务；初始不配置模型上游，用户显式添加渠道后可通过原 relay 路由发起真实调用并产生费用。只绑定 127.0.0.1:3180，8 小时自动停止。真实 Login、OAuth、desktop 和原网站业务路由处理请求；未冒充真实 MySQL 环境。
- 网站绑定 127.0.0.1:5180，代理到上述 API。`VITE_API_PROXY_STRICT=true` 禁止预览后端不可用时自动回退到用户已有 3100 服务。

## 替代与兼容

不修改生产 OAuth singleton 来满足新桌面客户端；桌面协议本来使用独立登记。未采用任意可配置 origin，避免账户凭证发往不可信服务。未将浏览器 renderer 当作原生联调结果，使用真实 .app 接收系统回调。

已有网站、旧 OAuth、支付/relay 和默认桌面构建不改协议。本地 feature 下充值/兑换跳转本地原充值页，个人资料跳转本地原资料页；独立订阅入口保持原地址。保留原支付逻辑，不模拟支付成功。初始不配置商户或模型上游；用户本地添加渠道后，通过原 relay 路由执行模型请求，保持原鉴权和计费行为，不生成假成功响应。网站名称保持“兔子API”。

## 回退与限制

退出预览 bundle、停止预览服务即可恢复日常使用；默认开发构建需不带 local-preview。不清除用户原有配置或安全存储。macOS 会将最近启动的预览 bundle 作为同一 URL scheme 的候选；完成体验后退出预览，并重新启动日常客户端，再核对系统打开的应用名。

本次不代表 T19 全项、MySQL/Redis、Windows/Linux、三平台安装包和发布门禁已完成。运行与复现见 ../local-preview.md。
