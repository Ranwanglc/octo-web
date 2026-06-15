import React, { Component } from "react";
import {
    Button,
    Spin,
    Toast,
    Banner,
    Dropdown,
    Tag,
    Modal,
    TextArea,
} from "@douyinfe/semi-ui";
import { IconEdit, IconMore, IconSend, IconClock, IconTick, IconClose, IconInfoCircle, IconHistory, IconUser } from "@douyinfe/semi-icons";
import { Channel, ChannelTypeGroup, ChannelTypePerson, MessageText, WKSDK } from "wukongimjssdk";
import { I18nContext, t } from "@octo/base";
import WKApp from "@octo/base/src/App";
import { splitSummaryText } from "../utils/splitMessage";
import SummaryConfirmPage from "./SummaryConfirmPage";
import * as api from "../api/summaryApi";
import OverflowTooltip from "../components/OverflowTooltip";
import type {
    SummaryDetail,
    PersonalResult,
    MemberStatus,
    ScheduleItem,
    ScheduleConfig,
} from "../types/summary";
import { TaskStatus, SummaryMode, ParticipantStatus } from "../types/summary";
import {
    formatDate,
    canCancel,
    canRegenerate,
    scheduleItemToConfig,
    scheduleToParams,
    formatScheduleSummary,
    shouldReactivateOnSave,
} from "../utils/summaryHelpers";
import CitationText from "../components/CitationText";
import SelectedSourcesPanel from "../components/SelectedSourcesPanel";
import ScheduleConfigModal from "../components/ScheduleConfigModal";
import MatterPickerModal from "../components/MatterPickerModal";
import * as matterBridge from "../api/matterBridge";
import SummaryEditor from "../components/SummaryEditor";

interface SummaryDetailPageProps {
    taskId?: number;
}

interface SummaryDetailPageState {
    detail: SummaryDetail | null;
    loading: boolean;
    error: string | null;
    personalResult: PersonalResult | null;
    members: MemberStatus[];
    personalLoading: boolean;
    membersLoading: boolean;
    scheduleLoading: boolean;
    scheduleItem: ScheduleItem | null;
    scheduleDisabling: boolean;
    showScheduleConfig: boolean;
    scheduleConfig: ScheduleConfig | null;
    lastKnownStatus?: number;
    expandedReports: Record<string, boolean>;
    isEditing: boolean;
    showMatterPicker: boolean;
    forwardingToMatter: boolean;
    showRegenerateModal: boolean;
    regenerateTopic: string;
    regenerateSubmitting: boolean;
    /** V5：schedule 级一次性确认提交中 */
    confirmingSchedule: boolean;
}

const INTER_MESSAGE_DELAY_MS = 200;

export default class SummaryDetailPage extends Component<SummaryDetailPageProps, SummaryDetailPageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: SummaryDetailPageState = {
        detail: null,
        loading: false,
        error: null,
        personalResult: null,
        members: [],
        personalLoading: false,
        membersLoading: false,
        scheduleLoading: false,
        scheduleItem: null,
        scheduleDisabling: false,
        showScheduleConfig: false,
        scheduleConfig: null,
        expandedReports: {},
        isEditing: false,
        showMatterPicker: false,
        forwardingToMatter: false,
        showRegenerateModal: false,
        regenerateTopic: "",
        regenerateSubmitting: false,
        confirmingSchedule: false,
    };

    private personalPollTimer: ReturnType<typeof setInterval> | null = null;
    private fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
    private fallbackStartTimeout: ReturnType<typeof setTimeout> | null = null;
    private listPageActive = false;
    private lastEventTime = 0;
    private isPersonalPolling = false;
    // Blocking 5（跨 task 串台 / async race）：单调递增的「调度加载序列号」。
    // 每次发起一轮 detail+schedule 加载（loadDetail / 状态切换补拉 / 重新加载）都 bump，
    // loadSchedule 在 setState 前用「发起时捕获的 seq」与最新 seq 比对：不一致说明期间
    // 已切换 task 或重新加载，旧请求的响应必须丢弃，绝不污染当前 task 的 scheduleItem。
    private scheduleLoadSeq = 0;

    /** bump 并返回最新调度加载序列号；任何会改变「当前 scheduleItem 归属」的入口都应调用。 */
    private nextScheduleSeq(): number {
        this.scheduleLoadSeq += 1;
        return this.scheduleLoadSeq;
    }

    componentDidMount() {
        window.addEventListener("summary-status-change", this.handleStatusChangeEvent);
        window.addEventListener("summary-batch-heartbeat", this.handleBatchHeartbeat);
        window.addEventListener("summary-list-unmount", this.handleListPageUnmount);
        this.loadDetail();
    }

    componentDidUpdate(prevProps: any) {
        const prevTaskId = prevProps.taskId;
        const currentTaskId = this.taskId;
        if (prevTaskId !== currentTaskId && currentTaskId != null) {
            this.listPageActive = false;
            this.clearAllTimers();
            // Blocking 5：切 task 立即清空上一 task 的 schedule 状态，避免在新 detail
            // 返回前闪现旧定时（bump seq 由 loadDetail 内部完成，令旧 loadSchedule 作废）。
            this.setState({ scheduleItem: null, scheduleLoading: false });
            this.loadDetail();
        }
    }

    componentWillUnmount() {
        window.removeEventListener("summary-status-change", this.handleStatusChangeEvent);
        window.removeEventListener("summary-batch-heartbeat", this.handleBatchHeartbeat);
        window.removeEventListener("summary-list-unmount", this.handleListPageUnmount);
        this.clearAllTimers();
    }

    private clearAllTimers() {
        if (this.personalPollTimer) {
            clearInterval(this.personalPollTimer);
            this.personalPollTimer = null;
        }
        this.stopFallbackPoll();
    }

    get taskId(): number | null {
        return this.props.taskId ?? null;
    }

    async loadDetail() {
        if (this.taskId == null) return;
        // Blocking 5：每轮 detail 加载开始就 bump 序列号。这样旧 task 未完成的
        // loadSchedule（包括本函数下面发起的）都会被后续轮作废，不会回填到新 task。
        const seq = this.nextScheduleSeq();
        const requestTaskId = this.taskId;
        this.setState({ loading: true, error: null });
        try {
            const detail = await api.getSummaryDetail(this.taskId);
            // detail 本身也可能是旧请求：期间切了 task / 又发了一轮 loadDetail 就丢弃。
            if (this.scheduleLoadSeq !== seq || this.taskId !== requestTaskId) return;
            this.setState({ detail, loading: false, lastKnownStatus: detail.status });

            // Blocking 5（跨 task 串台）：scheduleItem 必须始终对应当前 detail。
            // 同步部分：从「有定时」总结导航到「无定时」总结时，若不显式清空，旧 scheduleItem
            // 会残留 → renderScheduleButton 误判有定时、保存可能把旧定时重绑到新 task。
            // 异步部分：loadSchedule 带上 seq，响应迟到时对比 seq/taskId 才 setState（见 loadSchedule）。
            if (detail.schedule_id && detail.schedule_id > 0) {
                this.loadSchedule(detail.schedule_id, seq);
            } else {
                this.setState({ scheduleItem: null, scheduleLoading: false });
            }

            // Start fallback poll if task is in progress
            if (
                detail.status === TaskStatus.PROCESSING ||
                detail.status === TaskStatus.PENDING ||
                detail.status === TaskStatus.WAITING_CONFIRM
            ) {
                this.startFallbackPoll();
            } else {
                this.stopFallbackPoll();
            }
            // Load BY_PERSON data
            if (detail.summary_mode === SummaryMode.BY_PERSON) {
                this.loadPersonalResult();
                this.loadMembers();
            }
        } catch (err: any) {
            this.setState({ error: err.message || t("summary.common.loadingFailed"), loading: false });
        }
    }

    /**
     * Blocking 5（async race）：只有当发起请求时捕获的 seq 与当前 seq 一致、
     * 且 taskId 未变时，才能把响应写回 scheduleItem。不传 seq 时（handleScheduleSave
     * 等同一 task 内的主动刷新）自动 bump 一个新 seq 作为基准，语义上代表
     * 「这次是最新的一次 schedule 加载」。
     */
    async loadSchedule(scheduleId: number, seq?: number) {
        const reqSeq = seq ?? this.nextScheduleSeq();
        const requestTaskId = this.taskId;
        this.setState({ scheduleLoading: true });
        try {
            const item = await api.getSchedule(scheduleId);
            // 旧请求（期间又发了一轮加载 / 切了 task）迟到 resolve：丢弃，不污染新 task。
            if (this.scheduleLoadSeq !== reqSeq || this.taskId !== requestTaskId) return;
            this.setState({ scheduleItem: item, scheduleLoading: false });
        } catch {
            // 同样：只有仍是最新请求才允许清空，避免旧请求的失败反而抹掉新 task 的定时。
            if (this.scheduleLoadSeq !== reqSeq || this.taskId !== requestTaskId) return;
            // Blocking 5：加载失败也要清空 scheduleItem，避免上一条总结的定时残留，
            // 保证 scheduleItem 始终对应当前 detail（宁可显示「设置定时」也不串台）。
            this.setState({ scheduleItem: null, scheduleLoading: false });
        }
    }

    async loadPersonalResult() {
        if (this.taskId == null) return;
        this.setState({ personalLoading: true });
        try {
            const result = await api.getPersonalResult(this.taskId);
            this.setState({ personalResult: result, personalLoading: false });
            this.startPersonalPoll(result.worker_status);
        } catch {
            this.setState({ personalLoading: false });
        }
    }

    async loadMembers() {
        if (this.taskId == null) return;
        this.setState({ membersLoading: true });
        try {
            const members = await api.getMembers(this.taskId);
            this.setState({ members, membersLoading: false });
        } catch {
            this.setState({ membersLoading: false });
        }
    }

    startPersonalPoll(workerStatus: number) {
        if (this.personalPollTimer) clearInterval(this.personalPollTimer);
        if (workerStatus === 0 || workerStatus === 1) {
            this.personalPollTimer = setInterval(async () => {
                if (this.taskId == null) return;
                if (this.isPersonalPolling) return;
                this.isPersonalPolling = true;
                try {
                    const result = await api.getPersonalResult(this.taskId);
                    this.setState({ personalResult: result });
                    if (result.worker_status !== 0 && result.worker_status !== 1) {
                        if (this.personalPollTimer) clearInterval(this.personalPollTimer);
                        this.loadMembers();
                    }
                } catch {
                    // ignore poll errors
                } finally {
                    this.isPersonalPolling = false;
                }
            }, 5000);
        }
    }

    handleSubmitPersonal = async () => {
        if (this.taskId == null) return;
        try {
            await api.submitPersonalResult(this.taskId);
            Toast.success(t("summary.detail.submitSuccess"));
            this.loadPersonalResult();
            this.loadMembers();
        } catch (err: any) {
            Toast.error(err.message || t("summary.detail.submitFailed"));
        }
    };

    handleRespondToTask = async (action: "accept" | "reject") => {
        if (this.taskId == null) return;
        try {
            await api.respondToTask(this.taskId, action);
            Toast.success(action === "accept" ? t("summary.action.accepted") : t("summary.action.rejected"));
            this.loadDetail();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    private handleBatchHeartbeat = (event: Event) => {
        if (this.taskId == null) return;
        const taskIds: number[] | undefined = (event as CustomEvent).detail?.taskIds;
        if (!taskIds || !taskIds.includes(this.taskId)) return;

        this.listPageActive = true;
        this.lastEventTime = Date.now();
        this.stopFallbackPoll();
    };

    private handleStatusChangeEvent = async (event: Event) => {
        if (this.taskId == null) return;

        const detail_ = (event as CustomEvent).detail;
        const taskIds: number[] | undefined = detail_?.taskIds;
        if (!taskIds || !taskIds.includes(this.taskId)) return;

        this.listPageActive = true;
        this.lastEventTime = Date.now();
        this.stopFallbackPoll();

        try {
            const detail = await api.getSummaryDetail(this.taskId);
            const prevStatus = this.state.lastKnownStatus;
            const newStatus = detail.status;
            this.setState({ detail, lastKnownStatus: newStatus });

            if (prevStatus !== undefined && prevStatus !== newStatus) {
                if (
                    newStatus === TaskStatus.COMPLETED ||
                    newStatus === TaskStatus.FAILED ||
                    newStatus === TaskStatus.CANCELLED
                ) {
                    if (detail.summary_mode === SummaryMode.BY_PERSON) {
                        this.loadPersonalResult();
                        this.loadMembers();
                    }
                }
            }
        } catch {
            // ignore
        }
    };

    private handleListPageUnmount = () => {
        this.listPageActive = false;
        const status = this.state.lastKnownStatus;
        if (
            status === TaskStatus.PENDING ||
            status === TaskStatus.WAITING_CONFIRM ||
            status === TaskStatus.PROCESSING
        ) {
            this.startFallbackPoll();
        }
    };

    private startFallbackPoll() {
        if (this.fallbackPollTimer || this.fallbackStartTimeout) return;

        if (this.listPageActive && Date.now() - this.lastEventTime > 15000) {
            this.listPageActive = false;
        }
        if (this.listPageActive) return;

        this.fallbackStartTimeout = setTimeout(() => {
            this.fallbackStartTimeout = null;
            if (this.listPageActive) return;

            this.doFallbackPollOnce();

            this.fallbackPollTimer = setInterval(async () => {
                this.doFallbackPollOnce();
            }, 15000);
        }, 5000);
    }

    private async doFallbackPollOnce() {
        if (this.taskId == null) return;
        try {
            const updates = await api.batchStatus([this.taskId]);
            const update = updates.find(u => u.id === this.taskId);
            if (!update) return;

            const prevStatus = this.state.lastKnownStatus;
            const newStatus = update.status;

            if (prevStatus !== undefined && prevStatus !== newStatus) {
                try {
                    const detail = await api.getSummaryDetail(this.taskId);
                    this.setState({ detail, lastKnownStatus: newStatus });
                    if (
                        newStatus === TaskStatus.COMPLETED ||
                        newStatus === TaskStatus.FAILED ||
                        newStatus === TaskStatus.CANCELLED
                    ) {
                        this.stopFallbackPoll();
                        if (detail.summary_mode === SummaryMode.BY_PERSON) {
                            this.loadPersonalResult();
                            this.loadMembers();
                        }
                        if (detail.schedule_id && detail.schedule_id > 0) {
                            this.loadSchedule(detail.schedule_id);
                        }
                    }
                } catch {
                    // Don't advance lastKnownStatus — retry on next tick
                }
            }
        } catch {
            // ignore polling errors
        }
    }

    private stopFallbackPoll() {
        if (this.fallbackStartTimeout) {
            clearTimeout(this.fallbackStartTimeout);
            this.fallbackStartTimeout = null;
        }
        if (this.fallbackPollTimer) {
            clearInterval(this.fallbackPollTimer);
            this.fallbackPollTimer = null;
        }
    }

    handleRegenerate = () => {
        const { detail } = this.state;
        if (this.taskId == null) return;
        this.setState({
            showRegenerateModal: true,
            regenerateTopic: detail?.title || "",
        });
    };

    handleRegenerateConfirm = async () => {
        if (this.taskId == null || this.state.regenerateSubmitting) return;
        const trimmed = this.state.regenerateTopic.trim();
        if (!trimmed) return;
        this.setState({ regenerateSubmitting: true });
        try {
            await api.regenerateSummary(this.taskId, { topic: trimmed });
            Toast.success(t("summary.detail.regenerateStarted"));
            this.setState({ showRegenerateModal: false });
            this.loadDetail();
            window.dispatchEvent(new CustomEvent("summary-task-regenerated", { detail: { taskId: this.taskId } }));
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        } finally {
            this.setState({ regenerateSubmitting: false });
        }
    };

    handleRegenerateCancel = () => {
        this.setState({ showRegenerateModal: false });
    };

    handleCancel = async () => {
        if (this.taskId == null) return;
        try {
            await api.cancelSummary(this.taskId);
            Toast.success(t("summary.detail.cancelSuccess"));
            this.loadDetail();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    openScheduleModal = () => {
        const { scheduleItem } = this.state;
        // Blocking 1：is_active=false 的记录在交互上视为「无活动定时」，但仍回填
        // 原有周期/时刻，方便用户「重新启用」时不用从零填。保存逻辑（handleScheduleSave）
        // 会检测原记录是否 inactive 并走重新启用路径。
        if (scheduleItem) {
            this.setState({
                scheduleConfig: scheduleItemToConfig(scheduleItem),
                showScheduleConfig: true,
            });
        } else {
            this.setState({
                scheduleConfig: { unit: "week", every: 1, time: "09:00" },
                showScheduleConfig: true,
            });
        }
    };

    /**
     * V5/§4.2/§6.1：本任务是否「多人」。
     *
     * 竞态修复（第3轮）：members 来自 loadDetail 之后的二次异步 getMembers，到达
     * 时间不确定。若以 members.length 作主判据，members 未回填的窗口里多人任务会被
     * 误判为单人 → handleScheduleSave 漏传 confirm_policy=1。
     *
     * 因此判定的「可靠数据源」改为 detail.participants —— 它随 loadDetail 的
     * getSummaryDetail 一并同步返回（不依赖二次异步），且语义即本任务全体参与者
     *（含 creator + 协作成员）。只有当 detail 里就没有 participants 信息时，才退回
     * 用已加载的 members 兜底。
     *
     * 注意：这里只回答「是否多人」。members 是否「已加载完成」由 handleScheduleSave
     * 的保存前 guard（isMembersReadyForSave）单独把关，避免把「members 加载中」误
     * 当「确实单人」。
     */
    private isMultiPerson(): boolean {
        const { detail, members } = this.state;
        // 主判据：detail.participants（同步随 detail 返回，不受二次异步竞态影响）。
        if (detail && Array.isArray(detail.participants) && detail.participants.length > 0) {
            return detail.participants.length > 1;
        }
        // 兜底：detail 没带 participants 时，用已加载的 members。
        return members.length > 1;
    }

    /**
     * 竞态修复（第3轮）：保存定时前判断「多人判定所依赖的数据是否已可靠就绪」。
     *
     * - 若 isMultiPerson 能从 detail.participants 得出结论（detail 已加载且带
     *   participants），则判定不依赖二次异步 members，任何时刻都可靠 → 直接就绪。
     * - 否则（只能退回 members 兜底）必须等 members 加载完成才允许保存；membersLoading
     *   为 true 时表示「members 加载中」，此时不能保存（不能把加载中误当单人）。
     *
     * 用 membersLoading 标志严格区分「加载中」(true) 与「已加载且确实单人」(false 且
     * members.length<=1)。
     */
    private isMembersReadyForSave(): boolean {
        const { detail, membersLoading } = this.state;
        // detail 带 participants → 多人判定不依赖 members，始终就绪。
        if (detail && Array.isArray(detail.participants) && detail.participants.length > 0) {
            return true;
        }
        // 退回 members 兜底的情形：members 仍在加载中则未就绪。
        return !membersLoading;
    }

    handleScheduleSave = async (config: ScheduleConfig) => {
        const { detail, scheduleItem } = this.state;
        if (!detail) return;

        // 竞态修复（第3轮）finding 1：多人判定只能退回 members 兜底且 members 尚未
        // 加载完成时，不能保存——否则 isMultiPerson() 会把「members 加载中」误判为
        // 单人，漏传 confirm_policy=1（手动转定时未触发后端一次性确认重置）。
        // 阻止保存并提示，等 members 就绪后用户重试。
        if (!this.isMembersReadyForSave()) {
            Toast.warning(t("summary.detail.membersLoadingRetry"));
            return;
        }

        // V5：多人定时（手动转定时/改定时）写路径必须带 confirm_policy=1，
        // 触发后端一次性确认（create 全员置 confirmed=false；update 重置确认）。
        // 单人不传 confirm_policy，走后端兜底。复用 scheduleToParams 的条件透传。
        const confirmPolicy = this.isMultiPerson() ? 1 : undefined;
        const { cron_expr, interval_days, interval_months, day_of_week, day_of_month, run_time, confirm_policy } =
            scheduleToParams({ ...config, confirm_policy: confirmPolicy });

        try {
            if (scheduleItem) {
                // Blocking 1：原记录被停用（is_active=false）时，仅 update 不会把 is_active
                // 切回 true，定时仍不生效。所以：先 update 应用新配置，再 toggle(id,true)
                // 重新启用。toggle 在 re-enable 时会按 NextRunWithInterval 重算 next_run_at 到
                // 未来，保证「停用→再设置保存→定时真正重新生效」。
                const wasInactive = shouldReactivateOnSave(scheduleItem);

                // Plan A1: detail-page edit is scoped to THIS summary. The backend
                // clones a new schedule (and rebinds this task) when the schedule
                // is shared by multiple summaries, so other summaries are not
                // affected. The response carries the effective schedule_id (the
                // clone's id when cloned, or the original id otherwise).
                const updated = await api.updateSchedule(scheduleItem.schedule_id, {
                    cron_expr,
                    interval_days,
                    interval_months,
                    day_of_week,
                    day_of_month,
                    run_time,
                    scope: 'task',
                    task_id: detail.task_id,
                    // V5：多人「改/转定时」带 confirm_policy=1 触发后端一次性确认重置。
                    ...(confirm_policy !== undefined ? { confirm_policy } : {}),
                });
                const effectiveScheduleId = updated?.schedule_id ?? scheduleItem.schedule_id;

                if (wasInactive) {
                    // 重新启用：对生效的 schedule_id（可能是 clone）调 toggle(true)，
                    // 把 is_active 置回 1 并把 next_run 推到未来。
                    await api.toggleSchedule(effectiveScheduleId, true);
                }

                Toast.success(t("summary.detail.scheduleSaved"));
                this.loadSchedule(effectiveScheduleId);
            } else {
                // 为「无定时」总结新建定时：一步式 create，带 scope='task' + task_id。
                // 后端在一个事务里原子完成：校验 task 归属 → 建定时 → Update
                // summary_task.schedule_id 绑定（一对一约束）。不再需要第二步 update
                // 绑定，也不会产生游离定时，所以去掉 B2 回滚。失败时后端返回
                // 中文错误（一对一约束 / 40004 无权限 / scope=task 必传 task_id 等），
                // 由下方 catch 的 Toast.error 透出 err.message。
                const newSchedule = await api.createSchedule({
                    title: detail.title,
                    summary_mode: detail.summary_mode,
                    cron_expr,
                    interval_days,
                    interval_months,
                    day_of_week,
                    day_of_month,
                    run_time,
                    time_range_type: 2,
                    sources: detail.sources,
                    scope: 'task',
                    task_id: detail.task_id,
                    // V5：多人「手动转定时」关键路径带 confirm_policy=1，
                    // 后端创建 participant_config 时全员（含 creator）置 confirmed=false。
                    ...(confirm_policy !== undefined ? { confirm_policy } : {}),
                });
                Toast.success(t("summary.detail.scheduleCreated"));
                // 拉取刚建并已绑定的定时回显。
                this.loadSchedule(newSchedule.schedule_id);
            }
            this.setState({ showScheduleConfig: false });
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.saveFailed"));
        }
    };

    // 任务1：「关闭定时」——停用（可恢复），不走 delete。
    // 调 toggleSchedule(..., false) 把 is_active 置 0，成功后刷新详情页定时状态。
    //
    // Blocking 4（降级）：这里 toggleSchedule(schedule_id, false) 是「全局」停用（未带
    // scope='task'）。之所以不改为 task-scoped disable：后端已上一对一约束（一个定时
    // 只绑一个总结），所以全局 disable 与本 task 级 disable 等价、实际无害。
    // ⚠若未来放开定时共享（一个定时绑多个总结），需改为 task-scoped disable，
    // 否则会误停其他总结的定时。
    handleScheduleDisable = async () => {
        const { scheduleItem } = this.state;
        if (!scheduleItem) return;
        this.setState({ scheduleDisabling: true });
        try {
            const updated = await api.toggleSchedule(scheduleItem.schedule_id, false);
            Toast.success(t("summary.detail.scheduleDisabled"));
            // 任务3：回显一致——停用后本地把 is_active 置 false，
            // 使 hasSchedule / 描述行不再把它当作“有效定时”。
            this.setState({
                scheduleItem: { ...scheduleItem, ...(updated || {}), is_active: false },
                showScheduleConfig: false,
                scheduleDisabling: false,
            });
        } catch (err: any) {
            this.setState({ scheduleDisabling: false });
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    handleForwardToChat = () => {
        const { detail } = this.state;
        if (!detail?.result?.content?.trim()) return;
        WKApp.shared.baseContext.showConversationSelect(async (channels: Channel[]) => {
            const cleanContent = (detail?.result?.content ?? '').replace(/\[\d+\]/g, '').replace(/  +/g, ' ').trim();
            const chunks = splitSummaryText(cleanContent);
            const errors: string[] = [];

            for (const ch of channels) {
                try {
                    for (let i = 0; i < chunks.length; i++) {
                        const msg = new MessageText(chunks[i]);

                        // Inject space_id for person channels (matching ConversationVM.sendMessage pattern)
                        const spaceId = WKApp.shared.currentSpaceId;
                        if (spaceId && ch.channelType === ChannelTypePerson) {
                            const originalEncodeJSON = msg.encodeJSON.bind(msg);
                            msg.encodeJSON = () => {
                                const obj = originalEncodeJSON();
                                obj.space_id = spaceId;
                                return obj;
                            };
                            msg.contentObj = { ...(msg.contentObj || {}), space_id: spaceId };
                        }

                        await WKSDK.shared().chatManager.send(msg, ch);
                        if (i < chunks.length - 1) {
                            await new Promise((r) => setTimeout(r, INTER_MESSAGE_DELAY_MS));
                        }
                    }
                } catch {
                    errors.push(ch.channelID);
                }
            }

            if (errors.length > 0) {
                if (errors.length === channels.length) {
                    Toast.error(t("summary.detail.forwardFailed"));
                } else {
                    Toast.error(t("summary.detail.partialForwardFailed", { values: { failed: errors.length, total: channels.length } }));
                }
            } else {
                Toast.success(t("summary.detail.forwarded"));
            }
        }, t("summary.detail.forwardToChat"));
    };

    handleForwardToMatter = () => {
        const { detail } = this.state;
        if (!detail || detail.status !== TaskStatus.COMPLETED) return;

        const content = detail.result?.content;
        if (!content?.trim()) {
            Toast.warning(t("summary.detail.noForwardContent"));
            return;
        }

        this.setState({ showMatterPicker: true });
    };

    handleMatterSelected = async (matterId: string, matterTitle: string) => {
        const { detail } = this.state;
        if (!detail) return;

        const content = detail.result?.content;
        if (!content?.trim()) return;

        this.setState({ forwardingToMatter: true, showMatterPicker: false });
        try {
            await matterBridge.addComment(matterId, content);
            Toast.success(t("summary.detail.forwardedToMatter", { values: { title: matterTitle } }));
        } catch (err: any) {
            Toast.error(err.message || t("summary.detail.forwardFailed"));
        } finally {
            this.setState({ forwardingToMatter: false });
        }
    };

    /**
     * Whether the personal summary content is already visible in BY_PERSON mode.
     * Mirrors the content-display predicate in renderPersonalSummary (shows when content is non-empty),
     * so the global "generating" card and the personal summary are guaranteed to be mutually exclusive
     * regardless of worker_status value/type/timing.
     */
    private get personalReady(): boolean {
        const { detail, personalResult } = this.state;
        return (
            detail?.summary_mode === SummaryMode.BY_PERSON &&
            !!personalResult?.content?.trim()
        );
    }

    renderProcessing() {
        const { t } = this.context;
        return (
            <div className="summary-detail-processing">
                <Spin size="large" />
                <h3 style={{ marginTop: 16 }}>
                    {t("summary.detail.processingTitle")}
                </h3>
                <div style={{ fontSize: 14, color: "var(--semi-color-text-2)", marginTop: 8 }}>
                    {t("summary.detail.processingDesc")}
                </div>
            </div>
        );
    }

    renderFailed() {
        const { detail } = this.state;
        const { t } = this.context;
        if (!detail) return null;
        return (
            <div className="summary-detail-failed">
                <div className="summary-detail-failed-icon">⚠️</div>
                <h3>{t("summary.detail.failedTitle")}</h3>
                {detail.error_message && (
                    <div className="summary-detail-failed-reason">
                        {detail.error_message}
                    </div>
                )}
                <div className="summary-detail-failed-meta">
                    <div>{t("summary.detail.taskNo", { values: { taskNo: detail.task_no } })}</div>
                    <div>{t("summary.detail.createdAt", { values: { time: formatDate(detail.created_at) } })}</div>
                </div>
            </div>
        );
    }

    renderCompleted() {
        const { detail } = this.state;
        const { t } = this.context;
        if (!detail || !detail.result) return null;
        return (
            <div className="summary-detail-result">
                <div className="summary-detail-result-header">
                    <h3>{t("summary.detail.contentTitle")}</h3>
                    <div className="summary-detail-result-badges">
                        <Tag color="blue" size="small" prefixIcon={<IconHistory />}>
                            {t("summary.common.version", { values: { version: detail.result.version } })}
                        </Tag>
                        <Tag color="green" size="small">
                            {t("summary.common.messagesCount", { values: { count: detail.result.total_msg_count } })}
                        </Tag>
                        {detail.result_is_edited && detail.result_edited_at && (
                            <Tag color="orange" size="small">
                                {t("summary.detail.edited")}
                            </Tag>
                        )}
                    </div>
                </div>
                <div className="summary-detail-result-content">
                    <CitationText content={detail.result.content} citations={detail.result.citations || []} />
                </div>
                <div className="summary-detail-result-footer">
                    <span className="summary-detail-result-time">
                        {t("summary.detail.generatedAt", { values: { time: formatDate(detail.result.generated_at) } })}
                    </span>
                    {detail.result_is_edited && detail.result_edited_at && (
                        <span className="summary-detail-result-time">
                            {t("summary.detail.lastEditedAt", { values: { time: formatDate(detail.result_edited_at) } })}
                        </span>
                    )}
                </div>
            </div>
        );
    }

    renderPersonalSummary() {
        const { personalResult, personalLoading, detail } = this.state;
        const { t } = this.context;
        if (personalLoading) {
            return (
                <div className="summary-detail-personal">
                    <div className="summary-detail-section-header">
                        <span>{t("summary.detail.mySummary")}</span>
                    </div>
                    <Spin size="small" />
                </div>
            );
        }
        if (!personalResult) return null;
        return (
            <div className="summary-detail-personal">
                <div className="summary-detail-section-header">
                    <span>{t("summary.detail.mySummary")}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {detail && detail.status === TaskStatus.COMPLETED && detail.permissions?.can_edit && !this.state.isEditing && (
                            <Button
                                size="small"
                                theme="borderless"
                                icon={<IconEdit />}
                                onClick={this.handleStartEdit}
                            >
                                {t("summary.common.edit")}
                            </Button>
                        )}
                        {this.renderScheduleButton()}
                        {personalResult.worker_status === 2 && !personalResult.submitted_at && this.state.members.length > 1 && (
                            <Button size="small" theme="solid" onClick={this.handleSubmitPersonal}>
                                {t("summary.detail.submitToAll")}
                            </Button>
                        )}
                    </div>
                </div>
                {personalResult.content && (
                    <div className="summary-detail-content-box">
                        <CitationText content={personalResult.content} citations={personalResult.citations || []} />
                    </div>
                )}
            </div>
        );
    }

    renderTeamSummary() {
        const { detail, members } = this.state;
        const { t } = this.context;
        if (!detail || !detail.result) return null;
        if (members.length <= 1) return null;
        const submittedCount = members.filter((m) => m.status === "submitted").length;
        if (submittedCount === 0) return null;
        return (
            <div className="summary-detail-team">
                <div className="summary-detail-section-header">
                    <span>{t("summary.detail.teamSummary")}</span>
                    <div className="summary-detail-section-badges">
                        <Tag color="cyan" size="small" prefixIcon={<IconUser />}>
                            {t("summary.detail.submittedPeople", { values: { count: submittedCount } })}
                        </Tag>
                        <Tag color="blue" size="small" prefixIcon={<IconHistory />}>
                            {t("summary.common.version", { values: { version: detail.result.version } })}
                        </Tag>
                    </div>
                </div>
                <div className="summary-detail-content-box">
                    <CitationText
                        content={detail.result.content}
                        citations={detail.result.citations || []}
                        teamCitations={detail.result.team_citations || []}
                        members={members}
                    />
                </div>
            </div>
        );
    }

    renderMemberStatus() {
        const { members, membersLoading } = this.state;
        const { t } = this.context;
        if (membersLoading) {
            return (
                <div className="summary-detail-members">
                    <h3>{t("summary.detail.memberStatus")}</h3>
                    <Spin size="small" />
                </div>
            );
        }
        // 如果只有 1 个人（creator 自己），不显示成员状态区块
        if (members.length <= 1) return null;

        const statusConfig: Record<string, { icon: React.ReactNode; label: string; type: "success" | "warning" | "danger" | "default" }> = {
            pending: { icon: <IconClock />, label: t("summary.memberStatus.pending"), type: "warning" },
            accepted: { icon: <IconTick />, label: t("summary.memberStatus.accepted"), type: "success" },
            declined: { icon: <IconClose />, label: t("summary.memberStatus.declined"), type: "danger" },
            processing: { icon: <IconInfoCircle />, label: t("summary.memberStatus.processing"), type: "default" },
            completed: { icon: <IconTick />, label: t("summary.memberStatus.completed"), type: "success" },
            submitted: { icon: <IconTick />, label: t("summary.memberStatus.submitted"), type: "success" },
        };

        return (
            <div className="summary-detail-members">
                <h3>{t("summary.detail.memberStatus")}</h3>
                <div className="summary-detail-members-list">
                    {members.map((m) => {
                        const st = statusConfig[m.status] || statusConfig["pending"];
                        const isMe = m.user_id === WKApp.loginInfo.uid;
                        return (
                            <div key={m.user_id} className="summary-detail-member-item">
                                <span className="summary-detail-member-name">{m.user_name}</span>
                                <Tag color={st.type} prefixIcon={st.icon} size="small">
                                    {st.label}
                                </Tag>
                                {isMe && m.status === "pending" && (
                                    <span style={{ display: "inline-flex", gap: 4, marginLeft: 8 }}>
                                        <Button size="small" theme="solid" onClick={() => this.handleRespondToTask("accept")}>{t("summary.action.accept")}</Button>
                                        <Button size="small" onClick={() => this.handleRespondToTask("reject")}>{t("summary.action.reject")}</Button>
                                    </span>
                                )}
                                {m.submitted_at && (
                                    <span className="summary-detail-member-time">
                                        {formatDate(m.submitted_at)}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    toggleReport = (userId: string) => {
        this.setState((prev) => ({
            expandedReports: { ...prev.expandedReports, [userId]: !prev.expandedReports[userId] },
        }));
    };

    renderParticipantReports() {
        const { members, membersLoading, expandedReports } = this.state;
        const { t } = this.context;
        // 如果只有 1 个人（creator 自己），不显示参与者报告区块
        if (membersLoading || members.length <= 1) return null;
        const submitted = members.filter((m) => m.submitted_at && m.content);
        const pending = members.filter((m) => !m.submitted_at || !m.content);
        if (submitted.length === 0 && pending.length === 0) return null;
        return (
            <div className="summary-detail-participant-reports">
                <h3>{t("summary.detail.participantReports")}</h3>
                {submitted.map((m) => {
                    const expanded = !!expandedReports[m.user_id];
                    const content = m.content!;
                    const needsTruncate = content.length > 100;
                    return (
                        <div
                            key={m.user_id}
                            className={`summary-detail-participant-report-item${needsTruncate ? " clickable" : ""}`}
                            onClick={() => needsTruncate && this.toggleReport(m.user_id)}
                        >
                            <div className="summary-detail-participant-report-header">
                                <span>{m.user_name}</span>
                                <span style={{ color: "var(--semi-color-text-3)", fontWeight: 400 }}>·</span>
                                <span style={{ fontSize: 13, color: "var(--semi-color-text-2)", fontWeight: 400 }}>
                                    {formatDate(m.submitted_at!)}
                                </span>
                            </div>
                            <div className="summary-detail-participant-report-content">
                                {expanded ? (
                                    <CitationText content={content} citations={m.citations || []} />
                                ) : (
                                    <div>
                                        {needsTruncate ? content.slice(0, 100) + "..." : content}
                                    </div>
                                )}
                            </div>
                            {needsTruncate && (
                                <div className="summary-detail-participant-report-toggle">
                                    {expanded ? t("summary.detail.collapse") : t("summary.detail.expandAll")}
                                </div>
                            )}
                        </div>
                    );
                })}
                {pending.map((m) => (
                    <div key={m.user_id} className="summary-detail-participant-report-pending">
                        <IconClock style={{ fontSize: 14 }} />
                        <span>{t("summary.detail.waitingSubmit", { values: { name: m.user_name } })}</span>
                    </div>
                ))}
            </div>
        );
    }

    handleStartEdit = () => {
        this.setState({ isEditing: true });
    };

    handleEditSave = () => {
        this.setState({ isEditing: false });
        this.loadDetail();
    };

    handleEditCancel = () => {
        this.setState({ isEditing: false });
    };

    renderScheduleButton() {
        const { detail, scheduleItem, scheduleLoading, isEditing } = this.state;
        const { t } = this.context;
        if (!detail?.permissions?.can_edit || isEditing) return null;

        // 任务3：hasSchedule 仅在存在且 is_active 时为 true。
        // 停用后文案回到「设置定时更新」。
        const hasActiveSchedule = !!scheduleItem && scheduleItem.is_active !== false;
        const hasSchedule =
            hasActiveSchedule ||
            (!scheduleItem && !!(detail.schedule_id && detail.schedule_id > 0));

        return (
            <Button
                size="small"
                theme="borderless"
                icon={<IconClock />}
                onClick={this.openScheduleModal}
                disabled={scheduleLoading}
                loading={scheduleLoading}
            >
                {t(hasSchedule ? "summary.detail.editSchedule" : "summary.detail.setSchedule")}
            </Button>
        );
    }

    /**
     * V5/§4.2：本任务是否为 V5 schedule 级 CONFIRM 任务。
     * 以 scheduleItem.confirm_policy===1 区分两条确认路：
     *  - true：WAITING_CONFIRM 入口走 schedule 级确认 banner（不导向旧页）。
     *  - false：旧 task 级 manual 确认流，保留导向 SummaryConfirmPage。
     * 无 scheduleItem 或 confirm_policy≠1 均视为旧路径（false）。
     */
    private isV5ScheduleConfirm(): boolean {
        const { scheduleItem } = this.state;
        return !!scheduleItem && scheduleItem.confirm_policy === 1;
    }

    /**
     * 竞态修复（第3轮）finding 2：WAITING_CONFIRM 多人分支的渲染分路决策。
     *
     * scheduleItem 由 loadDetail 之后的二次异步 loadSchedule 回填，到达时间不确定。
     * 若直接用 isV5ScheduleConfirm()（只看 confirm_policy===1）分路，scheduleItem 未到
     * 的瞬间窗口会返回 false → V5 CONFIRM 任务 fallback 到旧 SummaryConfirmPage。
     *
     * 因此把旧分支的条件从「!isV5」收紧为「已加载完成 && 确认不是 V5」：
     *  - 'loading'：scheduleLoading 期间（scheduleItem 尚未到）只显示加载态，不暴露
     *    任何确认入口，绝不 fallback 旧页。
     *  - 'v5'：加载完成且 confirm_policy===1 → schedule 级确认 banner。
     *  - 'legacy'：加载完成且确认非 V5（confirm_policy≠1）或确无 schedule
     *    （scheduleItem 为 null 且 scheduleLoading=false）→ 保留旧 SummaryConfirmPage 路径。
     */
    private waitingConfirmMode(): 'loading' | 'v5' | 'legacy' {
        if (this.state.scheduleLoading) return 'loading';
        return this.isV5ScheduleConfirm() ? 'v5' : 'legacy';
    }

    /**
     * V5/§4.5：当前登录用户是否尚需对本定时任务完成一次性确认。
     * 条件：confirm_policy=1（CONFIRM）且该用户在 participant_config 名单里 confirmed=false
     *（含 creator——creator 也要确认）。确认后永久免确认，按钮消失。
     * 兼容：participant_config 为旧纯数组时无 confirmed 态，视为需确认。
     */
    needsScheduleConfirm(): boolean {
        const { scheduleItem } = this.state;
        if (!scheduleItem) return false;
        if (scheduleItem.is_active === false) return false;
        if (scheduleItem.confirm_policy !== 1) return false;
        const uid = WKApp.loginInfo.uid;
        const pc = scheduleItem.participant_config;
        if (!pc || !uid) return false;
        // 旧纯数组（string[]）：无确认态 → 只要在名单里就视为需确认。
        if (Array.isArray(pc)) {
            return pc.includes(uid);
        }
        const me = (pc.participants || []).find((p) => p.user_id === uid);
        if (!me) return false;
        return me.confirmed !== true;
    }

    handleConfirmSchedule = async () => {
        const { scheduleItem } = this.state;
        if (!scheduleItem) return;
        this.setState({ confirmingSchedule: true });
        try {
            await api.confirmSchedule(scheduleItem.schedule_id);
            Toast.success(t("summary.detail.scheduleConfirmed"));
            // 复用现有加载路径刷新（不新增任何出站推送）：重拉 schedule 让按钮消失。
            this.loadSchedule(scheduleItem.schedule_id);
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        } finally {
            this.setState({ confirmingSchedule: false });
        }
    };

    // V5/§4.5：schedule 级一次性确认入口。常驻直到该成员确认成功；
    // 确认后后续所有轮不再出现。点击调 POST /summary-schedules/:id/confirm。
    renderScheduleConfirm() {
        const { t } = this.context;
        if (!this.needsScheduleConfirm()) return null;
        return (
            <Banner
                type="info"
                closeIcon={null}
                fullMode={false}
                style={{ marginTop: 12 }}
                description={
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <span>{t("summary.detail.scheduleConfirmHint")}</span>
                        <Button
                            theme="solid"
                            size="small"
                            loading={this.state.confirmingSchedule}
                            onClick={this.handleConfirmSchedule}
                        >
                            {t("summary.detail.scheduleConfirmButton")}
                        </Button>
                    </div>
                }
            />
        );
    }

    // 任务2：详情页直观展示当前定时（人类可读）。
    renderScheduleSummary() {
        const { detail, scheduleItem, isEditing } = this.state;
        const { t } = this.context;
        if (!detail?.permissions?.can_edit || isEditing) return null;
        if (!scheduleItem) return null;

        const inactive = scheduleItem.is_active === false;
        if (inactive) {
            // 已停用：灰色提示，不当作有效定时
            return (
                <div
                    className="summary-detail-schedule-summary summary-detail-schedule-summary--inactive"
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        color: "var(--semi-color-text-2)",
                        marginTop: 4,
                    }}
                >
                    <IconClock size="small" />
                    <span>{t("summary.detail.scheduleDisabledHint")}</span>
                </div>
            );
        }

        const text = formatScheduleSummary(scheduleItem);
        if (!text) return null;
        return (
            <div
                className="summary-detail-schedule-summary"
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    color: "var(--semi-color-text-1)",
                    marginTop: 4,
                }}
            >
                <IconClock size="small" style={{ color: "var(--semi-color-primary)" }} />
                <span>{text}</span>
            </div>
        );
    }

    renderHeader() {
        const { detail } = this.state;
        const { t } = this.context;

        // Build "..." menu items
        const menuItems: { node: string; key: string; onClick: () => void; danger?: boolean }[] = [];
        if (detail && canRegenerate(detail.status)) {
            menuItems.push({ node: t("summary.detail.regenerate"), key: "regenerate", onClick: this.handleRegenerate });
        }
        if (detail && canCancel(detail.status)) {
            menuItems.push({ node: t("summary.detail.cancelTask"), key: "cancel", onClick: this.handleCancel, danger: true });
        }

        return (
            <div className="summary-detail-header">
                <div className="summary-detail-header-inner">
                    <OverflowTooltip as="h2" className="summary-detail-title" title={detail?.title || t("summary.detail.defaultTitle")}>
                        {detail?.title || t("summary.detail.defaultTitle")}
                    </OverflowTooltip>
                    <div className="summary-detail-header-actions">
                        {(detail?.summary_mode !== SummaryMode.BY_PERSON || !this.state.personalResult || this.state.personalLoading) && this.renderScheduleButton()}
                        {detail && detail.status === TaskStatus.COMPLETED && (
                            <Button
                                theme="borderless"
                                icon={<IconSend />}
                                onClick={this.handleForwardToChat}
                            >
                                {t("summary.detail.forwardToChat")}
                            </Button>
                        )}
                        {detail && detail.status === TaskStatus.COMPLETED && (
                            <Button
                                theme="borderless"
                                icon={<IconSend />}
                                onClick={this.handleForwardToMatter}
                                loading={this.state.forwardingToMatter}
                                disabled={this.state.forwardingToMatter}
                            >
                                {t("summary.detail.forwardToMatter")}
                            </Button>
                        )}
                        {menuItems.length > 0 && (
                            <Dropdown
                                trigger="click"
                                position="bottomRight"
                                render={
                                    <Dropdown.Menu>
                                        {menuItems.map((item) => (
                                            <Dropdown.Item
                                                key={item.key}
                                                onClick={item.onClick}
                                                style={item.danger ? { color: "var(--semi-color-danger)" } : undefined}
                                            >
                                                {item.node}
                                            </Dropdown.Item>
                                        ))}
                                    </Dropdown.Menu>
                                }
                            >
                                <Button theme="borderless" icon={<IconMore />} />
                            </Dropdown>
                        )}
                    </div>
                </div>
                {this.renderScheduleSummary()}
                {this.renderScheduleConfirm()}
            </div>
        );
    }

    render() {
        const { detail, loading, error, showScheduleConfig, scheduleConfig } = this.state;
        const { t } = this.context;

        return (
            <div className="summary-detail-page">
                {this.renderHeader()}

                <div className="summary-detail-content-wrapper">
                    <div className="summary-detail-content-inner">
                        {loading && (
                            <div className="summary-detail-loading">
                                <Spin size="large" />
                            </div>
                        )}

                        {error && (
                            <Banner
                                type="warning"
                                description={t("summary.detail.errorCause")}
                                closeIcon={null}
                                style={{ marginBottom: 16 }}
                                fullMode={false}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span>{error}</span>
                                    <Button size="small" onClick={() => this.loadDetail()}>{t("summary.common.retry")}</Button>
                                </div>
                            </Banner>
                        )}

                        {detail && !loading && (() => {
                            const myP = detail.participants?.find((p) => p.user_id === WKApp.loginInfo.uid);
                            const isMultiParticipant = (detail.participants?.length ?? 0) > 1;
                            const isPendingInvite = isMultiParticipant && myP != null && myP.status === ParticipantStatus.PENDING;
                            return isPendingInvite ? (
                                <div
                                    className="summary-detail-respond-banner"
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 12,
                                        padding: "12px 16px",
                                        marginBottom: 16,
                                        background: "var(--semi-color-primary-light-default)",
                                        borderRadius: 8,
                                    }}
                                >
                                    <span style={{ flex: 1, color: "var(--semi-color-text-0)" }}>{t("summary.detail.inviteQuestion")}</span>
                                    <Button size="small" theme="solid" onClick={() => this.handleRespondToTask("accept")}>{t("summary.action.accept")}</Button>
                                    <Button size="small" onClick={() => this.handleRespondToTask("reject")}>{t("summary.action.reject")}</Button>
                                </div>
                            ) : null;
                        })()}

                        {detail && !loading && (
                            <>
                                {detail.summary_mode === SummaryMode.BY_PERSON && (
                                    <>
                                        {this.state.isEditing && this.state.personalResult && detail.result_id ? (
                                            <div className="summary-detail-personal">
                                                <h3>{t("summary.detail.mySummaryPlain")}</h3>
                                                <SummaryEditor
                                                    taskId={detail.task_id}
                                                    baseResultId={detail.result_id}
                                                    initialContent={this.state.personalResult.content || ""}
                                                    onSave={this.handleEditSave}
                                                    onCancel={this.handleEditCancel}
                                                />
                                            </div>
                                        ) : (
                                            this.renderPersonalSummary()
                                        )}
                                        {this.renderTeamSummary()}
                                        {this.renderMemberStatus()}
                                        {this.renderParticipantReports()}
                                    </>
                                )}

                                {(detail.status === TaskStatus.PENDING || detail.status === TaskStatus.PROCESSING) &&
                                    !this.personalReady &&
                                    this.renderProcessing()
                                }

                                {detail.status === TaskStatus.FAILED && this.renderFailed()}

                                {detail.status === TaskStatus.CANCELLED && (
                                    <div className="summary-detail-cancelled">
                                        <div style={{ fontSize: 48, marginBottom: 12 }}>🚫</div>
                                        <p style={{ fontSize: 16, fontWeight: 500 }}>{t("summary.detail.cancelledTitle")}</p>
                                        <p style={{ fontSize: 14, color: "var(--semi-color-text-2)", marginTop: 8 }}>
                                            {t("summary.detail.cancelledDesc")}
                                        </p>
                                    </div>
                                )}

                                {/* 单人时不显示"等待参与者确认"，因为creator自动接受 */}
                                {detail.status === TaskStatus.WAITING_CONFIRM && this.state.members.length > 1 && (() => {
                                    const mode = this.waitingConfirmMode();
                                    return mode === 'loading' ? (
                                        // 竞态修复（第3轮）finding 2：scheduleItem 由 loadDetail 之后的二次
                                        // 异步 loadSchedule 回填，未到达时 isV5ScheduleConfirm() 会返回 false。
                                        // 若此时直接 fallback 到旧 SummaryConfirmPage，V5 CONFIRM 任务会在
                                        // scheduleItem 未到的瞬间窗口落到旧 task 级确认流。因此定时加载
                                        // 未完成期间只显示加载态，不暴露任何确认入口；等 scheduleItem 到了
                                        // （scheduleLoading=false）再按 isV5ScheduleConfirm 分路。
                                        this.renderProcessing()
                                    ) : mode === 'v5' ? (
                                        // V5/§4.2：schedule 级 CONFIRM 任务（confirm_policy===1）。
                                        // 不再导向旧 task 级 SummaryConfirmPage（POST /summaries/:id/confirm
                                        // 选 sources，与「确认一次长期生效」语义冲突）。改为引导到
                                        // header 中常驻的 schedule 级确认 banner（renderScheduleConfirm →
                                        // POST /summary-schedules/:id/confirm）。进入本详情页即可触达该 banner。
                                        <div className="summary-detail-waiting">
                                            <div style={{ fontSize: 48, marginBottom: 12 }}>⏳</div>
                                            <p style={{ fontSize: 16, fontWeight: 500 }}>{t("summary.detail.waitingConfirmTitle")}</p>
                                            <p style={{ fontSize: 14, color: "var(--semi-color-text-2)", marginTop: 8, marginBottom: 16 }}>
                                                {t("summary.detail.scheduleConfirmHint")}
                                            </p>
                                        </div>
                                    ) : (
                                        // 旧的非 V5 / task 级 manual 确认流（confirm_policy 非 1 或无 schedule）
                                        // 保留走 SummaryConfirmPage，不破坏旧路径。
                                        <div className="summary-detail-waiting">
                                            <div style={{ fontSize: 48, marginBottom: 12 }}>⏳</div>
                                            <p style={{ fontSize: 16, fontWeight: 500 }}>{t("summary.detail.waitingConfirmTitle")}</p>
                                            <p style={{ fontSize: 14, color: "var(--semi-color-text-2)", marginTop: 8, marginBottom: 16 }}>
                                                {t("summary.detail.waitingConfirmDesc")}
                                            </p>
                                            <Button onClick={() => WKApp.routeLeft.push(<SummaryConfirmPage taskId={this.taskId} />)}>
                                                {t("summary.detail.viewConfirmStatus")}
                                            </Button>
                                        </div>
                                    );
                                })()}
                                {/* 单人 WaitingConfirm 状态显示生成中（个人总结已出则不再显示 loading） */}
                                {detail.status === TaskStatus.WAITING_CONFIRM && this.state.members.length <= 1 && !this.personalReady && (
                                    this.renderProcessing()
                                )}

                                {detail.status === TaskStatus.COMPLETED && detail.summary_mode !== SummaryMode.BY_PERSON && (
                                    this.renderCompleted()
                                )}

                                <SelectedSourcesPanel sources={detail.sources} />
                            </>
                        )}
                    </div>
                </div>

                <ScheduleConfigModal
                    visible={showScheduleConfig}
                    value={scheduleConfig || { unit: "week", every: 1, time: "09:00" }}
                    onConfirm={this.handleScheduleSave}
                    onCancel={() => this.setState({ showScheduleConfig: false })}
                    hasExisting={!!this.state.scheduleItem && this.state.scheduleItem.is_active !== false}
                    onDisable={this.handleScheduleDisable}
                    disabling={this.state.scheduleDisabling}
                />
                <MatterPickerModal
                    visible={this.state.showMatterPicker}
                    onSelect={this.handleMatterSelected}
                    onCancel={() => this.setState({ showMatterPicker: false })}
                />
                <Modal
                    title={t("summary.detail.regenerateEditTitle")}
                    visible={this.state.showRegenerateModal}
                    onOk={this.handleRegenerateConfirm}
                    onCancel={this.handleRegenerateCancel}
                    okText={t("summary.detail.regenerate")}
                    cancelText={t("summary.common.cancel")}
                    confirmLoading={this.state.regenerateSubmitting}
                    okButtonProps={{ disabled: !this.state.regenerateTopic.trim() }}
                >
                    <label id="regenerate-topic-label" style={{ display: "block", marginBottom: 8, color: "var(--semi-color-text-1)" }}>
                        {t("summary.detail.regenerateTopicLabel")}
                    </label>
                    <TextArea
                        aria-labelledby="regenerate-topic-label"
                        autosize={{ minRows: 3, maxRows: 8 }}
                        maxCount={1000}
                        value={this.state.regenerateTopic}
                        onChange={(value) => this.setState({ regenerateTopic: value.slice(0, 1000) })}
                    />
                </Modal>
            </div>
        );
    }
}
