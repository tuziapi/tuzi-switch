# UC-DL-02：主下载入口改为 opentu 集成测试包

用户从公网页面主按钮下载后看不到 opentu。核查确认主按钮指向正式仓库 v1.4.3，含 opentu 的 95530dda 测试包仅在页尾提供入口，导致页面宣传与主要下载目标不一致。

本次仅修正独立下载页，不改变客户端业务或发布正式 Release。主按钮仍叫“下载兔子助手”，按平台指向已完成的 Actions 41424346858 安装包 artifact；macOS 新增 Apple Silicon / Intel 选择，Windows ZIP 包含 EXE/MSI，Linux ZIP 包含三种格式。清楚标注“集成测试版 · 95530dda”、包含 opentu、需要 GitHub 登录、解压安装以及独立账户配置。旧正式版降为次要入口，明确不包含 opentu。

acceptance-build.json 固定成功 run 与完整客户端提交。构建核实仓库、工作流、成功状态、精确 SHA、四个平台 artifact 的归属/大小/有效期，页面校验相同 schema 和有效期；失败或过期不自动下载旧正式版。新字段与构建生成、前端验证、页面显示和测试同时补齐。原 Umami 仅 platform/version 两个维度，增加 Intel/Linux 和 test-SHA 格式，保留父窗口、同源校验和队列限制。

验证：5 项来源/架构/失败关闭/到期/统计桥回归通过；静态生产构建通过。浏览器逐项切换 macOS ARM、Intel、Windows、Linux，四个主按钮均精确匹配对应 artifact ID，无真实下载点击或生产统计事件。实际安装包沿用已成功的 95530dda，不因此声明签名、跨平台安装或真实业务验收完成。

本次范围是 GitHub Pages 独立包；API 网站 worktree 未修改。远端安装包未重建，源码分支与公网页面同步更新；新入口仍是未签名集成测试交付，不是正式发布。
