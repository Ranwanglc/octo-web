# Detail Schedule Button Report

## 改动文件

- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx`
- `packages/dmworksummary/src/i18n/zh-CN.json`
- `packages/dmworksummary/src/i18n/en-US.json`

## 按钮位置与显示条件

- 新增了一个复用的定时按钮入口：`renderScheduleButton()`。
- 主位置放在“我的总结”区块头部，紧挨现有编辑按钮之后。
  - 代码位置：
    - 编辑按钮：`packages/dmworksummary/src/pages/SummaryDetailPage.tsx:609`
    - 定时按钮插入点：`packages/dmworksummary/src/pages/SummaryDetailPage.tsx:619`
- 为避免 `personalResult` 为空时整个 `renderPersonalSummary()` 直接 `return null` 导致没有入口，又在页面顶部 header action 区加了一个兜底入口。
  - 代码位置：`packages/dmworksummary/src/pages/SummaryDetailPage.tsx:833`
- 实际显示条件：
  - `detail.permissions?.can_edit`
  - `!isEditing`
  - 不再要求 `detail.status === COMPLETED`
- 去重策略：
  - `BY_PERSON` 且有 `personalResult` 时，只在“我的总结”区块显示，保持和编辑按钮相邻。
  - `BY_PERSON` 但 `personalResult` 不存在或仍在加载时，改为在页头操作区显示兜底入口。
  - 非 `BY_PERSON` 页面则在页头操作区显示。
- 按钮属性：
  - `onClick={this.openScheduleModal}`
  - `icon={<IconClock />}`
  - `size="small"`
  - `theme="borderless"`
- 文案逻辑：
  - 有定时（`scheduleItem` 存在，或 `detail.schedule_id > 0`）时显示“修改定时更新”
  - 无定时时显示“设置定时更新”
- 为避免已有 `schedule_id` 但详情仍在加载时误开成新建态，按钮在 `scheduleLoading` 期间会禁用并显示 loading。

## i18n keys

- `summary.detail.setSchedule`
  - zh-CN: `设置定时更新`
  - en-US: `Set schedule`
- `summary.detail.editSchedule`
  - zh-CN: `修改定时更新`
  - en-US: `Edit schedule`
- 代码位置：
  - `packages/dmworksummary/src/i18n/zh-CN.json:235`
  - `packages/dmworksummary/src/i18n/en-US.json:235`

## 前端验证

### vitest

- 命令：`cd packages/dmworksummary && npx vitest run`
- 结果：通过
- 输出摘要：`6 passed (6)`，`51 passed (51)`

### tsc

- 命令：`cd packages/dmworksummary && npx tsc --noEmit`
- 结果：未通过，但属于既有环境/依赖问题，非本次修改引入
- 观察到的既有问题类型：
  - 依赖类型缺失，如 `react`、`lodash`、`prismjs`
  - 现有 class component 在当前类型环境下大量报 `setState/props` 相关错误
  - 第三方包 `@douyinfe/semi-foundation` 内部大量类型错误
- 额外核查：
  - 对本次改动附近行号做过滤检查：`SummaryDetailPage.tsx(619|792-808|833)` 无新增报错命中
  - 说明本次新增按钮与文案没有在变更行上引入新的 TypeScript 报错

## 构建与上线

### 镜像构建

- 命令：`cd /root/projects/octo-web && docker build -t octo-web:local .`
- 结果：成功
- 镜像 ID：`sha256:8e3319ade9f2f8dcde3c63f52b75c7007878468752bb03d81783b5e16d287cbe`
- 过程中出现的非阻塞信息：
  - Docker legacy builder deprecation 提示
  - Vite 提示 `VITE_API_URL is not set`
  - 打包产物 chunk size / eval warnings
  - 均未阻断构建

### 服务重启

- 命令：`cd /root/projects/octo-deploy && docker compose up -d octo-web`
- 结果：成功
- 操作范围：
  - 仅针对 `octo-web` 服务执行 recreate/start
  - 未执行整套 `down`
  - 未对 `summary-api`、`summary-worker`、`mysql`、`octo-server`、`wukongim` 等其他服务做变更

## 验活结果

### docker ps

- 命令：`docker ps --filter name=octo-web`
- 结果：
  - 容器：`octo-deploy-octo-web-1`
  - 镜像：`octo-web:local`
  - 状态：`Up`
  - 端口：`0.0.0.0:3000->80/tcp`

### HTTP 探活

- 命令：`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
- 结果：`200`

### 容器产物 grep

- 命令：`docker exec octo-deploy-octo-web-1 sh -c 'grep -rho "设置定时更新\\|修改定时更新" /usr/share/nginx/html 2>/dev/null | sort -u'`
- 结果：
  - `修改定时更新`
  - `设置定时更新`

## 报错情况

- 无阻断性报错。
- 已知非阻断项：
  - `tsc --noEmit` 仍有大量既有环境/依赖类型错误
  - Docker/Vite 打包阶段有 warning，但未影响镜像生成与服务启动

## 需要 Ares 确认的点

- 当前实现为了满足“无 `personalResult` 也要有入口”，采用了“双位置单实例”策略：
  - 有“我的总结”区块时，按钮和编辑按钮相邻
  - 没有该区块时，按钮出现在页头操作区
- 如果后续产品希望入口永远固定在页头，或永远固定在“我的总结”区块，需要再统一一次交互位置。
