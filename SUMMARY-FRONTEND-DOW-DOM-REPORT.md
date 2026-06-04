# 智能总结定时设置 — 前端「周几 / 几号」改造报告

日期：2026-06-04
负责包：`packages/dmworksummary`（@dmwork/summary）
分支：`feat/scheduled-summary`（working tree 改动，未 commit）

---

## 一、需求回顾

给「智能总结定时设置」表单加上：
- 选择**每周**时显示「周几」下拉（value 1..7，1=周一 .. 7=周日，对齐后端）。
- 选择**每月**时显示「几号」下拉（value 1..31）。
- 这两个下拉放在【时间选择（run_time）控件之前】。
- 选中值纳入表单 state，并随创建/更新请求体提交（`day_of_week` / `day_of_month`，0=不限）。
- 编辑已有 schedule 时回显已选值。
- 模式判定规则：`interval_months>0` => 月模式；`interval_days` 是 7 的倍数 => 周模式；否则天模式（都不显示）。前端实现上以「单位选择（天/周/月）」直接驱动显示，与该规则等价。

---

## 二、改了哪些文件、改了什么

### 1. `src/types/summary.ts`
为以下接口新增 `day_of_week?: number`、`day_of_month?: number` 字段：
- `ScheduleItem`（后端返回的定时项 → 用于编辑回显）
- `CreateScheduleParams`（创建请求体）
- `UpdateScheduleParams`（更新请求体）

`ScheduleConfig`（内部 UI 状态结构，供 ScheduleConfigModal 使用）新增可选字段：
- `dayOfWeek?: number`、`dayOfMonth?: number`（0/undefined = 不限）。

### 2. `src/components/ScheduleForm.tsx`（核心表单）
- 新增 `WEEKDAY_KEYS = [mon..sun]` 常量（索引+1 即 1..7，对齐后端）。
- 新增 state：`dayOfWeek`、`dayOfMonth`，初值取自 `initialValues?.day_of_week / day_of_month`（默认 0）。
- 新增 `weekdayOptions`（周一..周日 → value 1..7）和 `dayOfMonthOptions`（1..31 号）。
- 用 `isWeekMode = unit === "week"`、`isMonthMode = unit === "month"` 控制条件渲染。
- 在频率行内、**run_time 时间下拉之前**：
  - 周模式渲染「周几」Select；
  - 月模式渲染「几号」Select；
  - 月模式下方追加一行小字提示（29/30/31 在小月自动顺延到月末）。
- 提交时按当前模式决定写哪个字段，另一个置 0：
  - 周模式：`day_of_week = dayOfWeek||0`，`day_of_month=0`；
  - 月模式：`day_of_month = dayOfMonth||0`，`day_of_week=0`；
  - 天模式：两者都 0。
- `handleSubmit` 依赖数组补上 `dayOfWeek, dayOfMonth`。

### 3. `src/components/ScheduleConfigModal.tsx`（创建页/详情页复用的定时配置弹窗）
该弹窗同样含「频率 + 时间」表单，已同步加：
- `WEEKDAY_KEYS` 常量、`weekdayOptions` / `dayOfMonthOptions`。
- `isWeekMode` / `isMonthMode` 判定。
- 在「时间」行之前条件渲染「周几」/「几号」两行（沿用弹窗既有 rowStyle/labelStyle/inlineStyle 风格）；月模式追加小字提示。
- 通过既有 `updateLocal({ dayOfWeek / dayOfMonth })` 写入 `ScheduleConfig`，回显走 `componentDidUpdate` 里既有的 `{...DEFAULT_CONFIG, ...this.props.value}`（value 来自 `scheduleItemToConfig`，见下）。

### 4. `src/utils/summaryHelpers.ts`
- `scheduleToParams(config)` 返回值新增 `day_of_week`、`day_of_month`：
  - 月：`day_of_month = config.dayOfMonth||0`，`day_of_week=0`；
  - 周：`day_of_week = config.dayOfWeek||0`，`day_of_month=0`；
  - 天：两者 0。
- `scheduleItemToConfig(item)` 入参新增可选 `day_of_week` / `day_of_month`，并在回填 `ScheduleConfig` 时带上 `dayOfWeek`（周）/`dayOfMonth`（月），用于弹窗回显。

### 5. `src/pages/ScheduleListPage.tsx`（独立定时列表页，使用 ScheduleForm）
- 编辑弹窗 `initialValues` 增加 `day_of_week` / `day_of_month`（取自 `editingSchedule`，默认 0）→ 实现编辑回显。
- `handleUpdate` 组装 `UpdateScheduleParams` 时带上 `day_of_week` / `day_of_month`（默认 0）。
- `handleCreate` 直接透传 `params`（已含新字段），无需改。

### 6. `src/pages/SummaryCreatePage.tsx` & `src/pages/SummaryDetailPage.tsx`（使用 ScheduleConfigModal）
- 两处 `scheduleToParams(...)` 解构补上 `day_of_week, day_of_month`，并在 `api.createSchedule` / `api.updateSchedule` 的请求体里带上这两个字段，使弹窗路径也能正确提交。

### 7. `src/api/summaryApi.ts`
- 无需改动代码：`createSchedule`/`updateSchedule` 直接接收 `CreateScheduleParams`/`UpdateScheduleParams` 并整体作为 body 发送，新增字段随类型自动透传。（已确认 payload 会带上 `day_of_week`/`day_of_month`。）

### 8. `src/hooks/useSchedule.ts`
- 无需改动：`create`/`update` 透传 params，类型已涵盖新字段，默认值由表单/页面层处理（0）。

### 9. i18n
`src/i18n/zh-CN.json` 与 `src/i18n/en-US.json` 在 `summary.schedule.config` 下新增 key（沿用现有命名风格）：
- `onWeekdayPrefix` / `onDayOfMonthPrefix`（行内前缀，如「周」「每月」/「on」「on day」）
- `weekdayLabel` / `dayOfMonthFieldLabel`（弹窗里的字段标签）
- `weekdayPlaceholder` / `dayOfMonthPlaceholder`（占位）
- `dayOfMonthLabel`（「{{day}} 号」/「Day {{day}}」选项文案）
- `dayOfMonthHint`（29/30/31 小月顺延到月末的提示）
- `weekday.{mon..sun}`（周一..周日 / Monday..Sunday）

---

## 三、设计要点 / 行为说明

- **value 对齐后端**：周几下拉 value 直接是 1..7（1=周一…7=周日）；几号下拉 value 1..31。
- **不选默认 0**：用户没选时提交 0（不限），后端按旧的自然推进。Select 用 `value={dayOfWeek || undefined}` 让占位文案能显示。
- **模式互斥**：切换单位后，仅提交当前模式对应字段，另一个强制 0，避免脏值。
- **月末钳位**：前端只做文案提示，钳位逻辑由后端处理（按需求）。
- **回显**：
  - 独立列表页（ScheduleForm）：`initialValues.day_of_week/day_of_month` 直接回填。
  - 创建/详情弹窗（ScheduleConfigModal）：经 `scheduleItemToConfig` → `ScheduleConfig.dayOfWeek/dayOfMonth` 回填。
- 严格只动定时设置相关代码，未重构无关逻辑，未触碰其他包。

---

## 四、验证结果

环境：仓库根 `node_modules` 原本未安装。已用 corepack 激活 `pnpm@10.32.0`（PATH 上原本无 pnpm），并 `pnpm install --frozen-lockfile`（`.npmrc` 已配 npmmirror 国内源）安装成功。

### 1. Lint
- `packages/dmworksummary/package.json` **没有 `scripts`**（空对象），仓库根 `pnpm lint`（turbo run lint）对该包解析到的 `Command = <NONEXISTENT>`，即**该包未接入 lint 任务**。
- 仓库根 `.eslintrc.js` 内容整体被注释掉，且各 package 无 `.eslintrc`/`eslint.config`，因此直接 `eslint <file>` 会因无 TS parser 报「Parsing error: import is reserved」——这是**仓库本身未配置 ESLint**导致的，并非本次改动引入。
- 结论：**该包当前没有可运行的 lint**；本次未引入任何 lint 配置变更。

### 2. 类型检查（TypeScript）
该包无 `type-check` 脚本，故直接用包内 tsconfig 跑 `tsc -p tsconfig.json --noEmit`。

- 标准做法（对比基线）：先对**改动后**与 `git stash` 后的**基线**分别跑 tsc，只看 `src/` 下的报错并对比：
  - 基线（无本次改动）：`src/` 报错 **335 条**。
  - 改动后：`src/` 报错 **335 条**。
  - 逐文件计数完全一致（`ScheduleForm.tsx` 5→5、`ScheduleConfigModal.tsx` 7→7、`ScheduleListPage.tsx` 17→17，两个 Summary 页面计数不变），错误码分布完全一致（TS2339/TS2607/TS2786/TS7016/TS7031 等）。
  - **结论：本次改动新增 0 条类型错误。**
- 这 335 条全是**预先存在的环境性报错**，与本次改动无关，典型为：
  - `TS7016 Could not find a declaration file for 'react'/'prismjs'`（react@17 的 index.js 被当作 any）；
  - `TS2339 Property 'setState' does not exist on type 'XxxPage'`、`TS2786 Xxx cannot be used as a JSX component`（class 组件 + React 类型在“裸 tsc 单包”模式下解析不正确）。
  - 原因是该包不是设计来用裸 `tsc` 单独类型检查的（正常类型检查走 build/IDE/工程化链路）。

### 3. 单元测试（vitest）
该包有 `vitest.config.ts`，运行 `vitest run`：
- **6 个测试文件、51 个用例全部通过**（含 SummaryEditor、MatterPickerModal、summaryApi、splitMessage 等）。
- 没有针对 ScheduleForm/ScheduleConfigModal 的现成专项测试（原仓库就没有），但已有套件未因本次改动出现回归。

### 4. 未做
- 未跑整仓 `pnpm build`（耗时大且非必需，按任务说明）。改动均为类型安全的字段透传 + 条件渲染，风险低。
- 未 git commit（按要求保留 working tree）。

---

## 五、是否需要 Ares 重建 octo-web 镜像

**需要。** 本次改动是前端源码（`packages/dmworksummary/src/*` + i18n json）。要上线必须重新构建 octo-web 前端产物并重建/更新镜像，浏览器侧才会加载到新表单与新提交字段。仅热重载在生产环境不生效。

---

## 六、遗留 / 需要确认的点

1. **Lint 未接入**：该包 `package.json` 无 `scripts`、仓库根 ESLint 配置被注释。本次按现状未补 lint。若 Ares 希望有 lint 门禁，需要单独工程化（不在本任务范围）。
2. **裸 tsc 报基线错误**：该包单独 `tsc` 有 335 条预存环境性报错（React 类型/类组件解析）。建议类型检查以工程化构建或 IDE 为准；本次已用「基线对比」证明零新增。
3. **后端字段命名一致性**：前端提交 `day_of_week`（1..7，1=周一）、`day_of_month`（1..31），不限传 0，已严格按任务给定契约。请 Ares 确认后端创建/更新接口字段名与取值范围与此一致（尤其 1=周一 而非 0/周日起）。
4. **回显依赖后端返回**：编辑回显要求后端 `GET schedule` / list 接口在 `ScheduleItem` 中返回 `day_of_week`/`day_of_month`。若后端列表/详情暂未回吐这两个字段，回显会显示为「未选」（0），但提交逻辑不受影响。
5. **天模式**：天模式（interval_days 非 7 倍数）下两个下拉都不显示，提交均为 0，符合需求。

---

## 七、改动文件清单（供 review）

```
M packages/dmworksummary/src/types/summary.ts
M packages/dmworksummary/src/components/ScheduleForm.tsx
M packages/dmworksummary/src/components/ScheduleConfigModal.tsx
M packages/dmworksummary/src/utils/summaryHelpers.ts
M packages/dmworksummary/src/pages/ScheduleListPage.tsx
M packages/dmworksummary/src/pages/SummaryCreatePage.tsx
M packages/dmworksummary/src/pages/SummaryDetailPage.tsx
M packages/dmworksummary/src/i18n/zh-CN.json
M packages/dmworksummary/src/i18n/en-US.json
（api/summaryApi.ts、hooks/useSchedule.ts 经评估无需改动，字段随类型自动透传）
A SUMMARY-FRONTEND-DOW-DOM-REPORT.md（本报告）
```
