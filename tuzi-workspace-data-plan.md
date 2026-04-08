# 兔子工作台真实数据接入最小方案

更新时间：2026-04-08

## 当前状态

- 前端已经有 `TuziWorkspacePanel`，可展示接入状态、Key 来源、余额、已用额度、请求次数等基础信息。
- 当前真实数据来源只有 `get_tuzi_key_usage`，更偏向单个 Key 的账户额度查询。
- 本地代理统计已经有独立数据链路：
  - `get_usage_summary`
  - `get_usage_trends`
  - `get_provider_stats`
  - `get_model_stats`
  - `get_request_logs`
- 兔子工作台和本地代理统计现在仍是两套数据语义：
  - 兔子工作台：更偏账户 / 业务视角
  - 本地代理统计：更偏本地代理请求视角

## 下一阶段目标

把兔子工作台从“接入状态 + Key 查询结果”提升到“账户总览 + 业务趋势 + 分布信息”。

优先补的不是更多页面，而是让工作台能稳定展示下面三类信息：

1. 账户总览
2. 时间趋势
3. 业务分布

## 推荐数据来源

不建议直接爬兔子 panel 页面。

推荐方案：

- 由兔子后端提供聚合接口
- `tuzi-switch` 使用兔子 Key，或通过一次交换得到的短期 token 拉取工作台数据
- 后端对外提供已经聚合好的 summary / trends / distribution 结果

这样做的原因：

- 前端结构稳定，不依赖 panel DOM
- 更容易控制鉴权和限流
- 后续能逐步扩展更多维度，而不是每次前端临时拼装

## 最小接口集合

### 1. Summary

用途：

- 兔子工作台顶部总览卡片
- 补齐“今日消耗 / 本月消耗 / 剩余额度 / 请求数 / 活跃线路数”

建议返回结构：

```ts
type TuziWorkspaceSummary = {
  success: boolean;
  currencySymbol: string;
  balance: number;
  usedToday: number;
  usedMonth: number;
  requestCountToday: number;
  requestCountMonth: number;
  activeRoutes: number;
  expiresAt?: number;
  note?: string;
  error?: string;
};
```

### 2. Trends

用途：

- 展示近 7 天 / 近 30 天的消耗趋势
- 后续可做工作台自己的趋势卡，而不是完全依赖本地代理统计

建议返回结构：

```ts
type TuziWorkspaceTrendPoint = {
  date: string;
  spend: number;
  requests: number;
  tokens?: number;
};
```

### 3. Distribution

用途：

- 展示主要业务线、模型或入口的使用占比
- 帮助用户理解“钱花在哪里”“主要用在哪条线路上”

建议返回结构：

```ts
type TuziWorkspaceDistributionItem = {
  key: string;
  label: string;
  value: number;
  percentage: number;
};

type TuziWorkspaceDistribution = {
  byBusinessLine: TuziWorkspaceDistributionItem[];
  byRoute: TuziWorkspaceDistributionItem[];
  byModel?: TuziWorkspaceDistributionItem[];
};
```

## 前端改造建议

### 第一阶段

目标：

- 不改大布局
- 只补数据模型和 query 层
- 让 `TuziWorkspacePanel` 能从单个 Key 查询过渡到聚合工作台查询

建议新增：

- `src/types/usage.ts`
  - 增加 `TuziWorkspaceSummary`
  - 增加 `TuziWorkspaceTrendPoint`
  - 增加 `TuziWorkspaceDistribution`
- `src/lib/api/usage.ts`
  - 增加 `get_tuzi_workspace_summary`
  - 增加 `get_tuzi_workspace_trends`
  - 增加 `get_tuzi_workspace_distribution`
- `src/lib/query/usage.ts`
  - 增加对应 query keys 和 hooks

### 第二阶段

目标：

- 把 `TuziWorkspacePanel` 拆成更稳定的三个区域

建议区域：

1. `TuziWorkspaceHeader`
   - 接入状态
   - 当前 Key 来源
   - 到期时间

2. `TuziWorkspaceSummaryCards`
   - 余额
   - 今日消耗
   - 本月消耗
   - 请求数

3. `TuziWorkspaceInsight`
   - 趋势图
   - 分布卡
   - 说明与异常提示

## 后端接口约束建议

- 统一返回 `success / note / error`
- 时间字段统一用 Unix seconds
- 金额字段统一返回 number，不要混用 string
- 趋势接口统一支持 `1d / 7d / 30d` 或等价的 `days`
- 分布接口尽量由后端直接算 percentage，避免前端重复计算和出现分母不一致

## 本周最小可交付

如果本周只做一个最小闭环，建议做到这里：

1. 明确后端是否能提供 `summary / trends / distribution` 三个接口
2. 先在前端补齐类型、API 封装和 query hooks
3. 先让 `TuziWorkspacePanel` 接 `summary`
4. 趋势和分布先保留占位区域，等接口准备好再接入

## 当前不建议做的事

- 不建议继续在前端硬推更多“模拟业务数据”
- 不建议直接解析兔子 panel 页面结构
- 不建议把本地代理统计数据直接伪装成兔子工作台真实账户数据

## 建议的下一步执行顺序

1. 先和兔子后端确认是否能提供聚合接口
2. 如果可以，先定 `summary` 的字段
3. 前端先把 `summary` 接入 `TuziWorkspacePanel`
4. 然后再做 `trends`
5. 最后补 `distribution`
