import { describe, expect, it, vi, beforeEach } from 'vitest';

// SummaryDetailPage import wukongimjssdk，测试环境会拉起无关依赖导致解析失败，mock 掉。
vi.mock('wukongimjssdk', () => ({
    Channel: class {},
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
    MessageText: class {},
    WKSDK: { shared: () => ({ chatManager: { send: vi.fn() } }) },
}));
vi.mock('@douyinfe/semi-ui', () => {
    const Passthrough = ({ children }: any) => children ?? null;
    const Typography: any = Passthrough;
    Typography.Text = Passthrough;
    const Dropdown: any = Passthrough;
    Dropdown.Menu = Passthrough;
    Dropdown.Item = Passthrough;
    return {
        Button: Passthrough,
        Typography,
        Tag: Passthrough,
        Avatar: Passthrough,
        Spin: Passthrough,
        Modal: Passthrough,
        Banner: Passthrough,
        Dropdown,
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    };
});
vi.mock('@douyinfe/semi-icons', () => ({
    IconPlus: () => null,
    IconClock: () => null,
    IconArrowLeft: () => null,
    IconRefresh: () => null,
    IconDelete: () => null,
    IconEdit: () => null,
    IconMore: () => null,
    IconSend: () => null,
    IconChevronDown: () => null,
}));

import * as api from '../../api/summaryApi';
import SummaryDetailPage from '../SummaryDetailPage';

vi.mock('../../api/summaryApi');

function makePage(taskId: number) {
    const page = new SummaryDetailPage({ taskId } as any);
    (page as any).context = { t: (k: string) => k };
    (page as any).setState = function (this: any, patch: any) {
        this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
    };
    return page;
}

const baseDetail = (over: any = {}) => ({
    task_id: 1,
    task_no: 'T1',
    title: 't',
    summary_mode: 1,
    status: 5, // 已完成-ish，避免触发 fallback poll 分支无所谓
    trigger_type: 0,
    time_range_start: '',
    time_range_end: '',
    sources: [],
    participants: [],
    result: null,
    error_message: null,
    created_at: '',
    updated_at: '',
    permissions: { can_edit: true },
    ...over,
});

describe('SummaryDetailPage — Blocking 5: scheduleItem must track current detail', () => {
    beforeEach(() => vi.clearAllMocks());

    it('clears stale scheduleItem when navigating to a detail with no schedule', async () => {
        // 模拟从「有定时」总结切到「无定时」总结：先有残留 scheduleItem。
        vi.mocked(api.getSummaryDetail).mockResolvedValue(baseDetail({ schedule_id: 0 }) as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 99, is_active: true } as any, // A 的残留
        };

        await page.loadDetail();

        // B 无定时 → 必须显式清空，避免串台。
        expect((page.state as any).scheduleItem).toBeNull();
        // 不应去拉取任何 schedule。
        expect(api.getSchedule).not.toHaveBeenCalled();
    });

    it('loadSchedule failure clears scheduleItem (no stale leak)', async () => {
        vi.mocked(api.getSchedule).mockRejectedValue(new Error('boom'));

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 99, is_active: true } as any,
        };

        await page.loadSchedule(123);

        expect((page.state as any).scheduleItem).toBeNull();
    });

    it('loads schedule when detail has a valid schedule_id', async () => {
        vi.mocked(api.getSummaryDetail).mockResolvedValue(baseDetail({ schedule_id: 55 }) as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 55, is_active: true } as any);

        const page = makePage(1);
        await page.loadDetail();

        expect(api.getSchedule).toHaveBeenCalledWith(55);
    });

    // 核心 blocker（async race / 跨 task 串台）：
    // 场景：从 summary A（有 schedule）切到 summary B（无 schedule），A 的 loadSchedule
    // 请求延迟返回。修复前：A 的响应会把 A 的 scheduleItem 覆盖到 B 的 state，
    // 导致 B 误显示「有定时」、保存时把 A 的定时误绑到 B 的 task。
    // 修复后：seq/taskId 不一致 → 丢弃旧响应，B 的 scheduleItem 保持为 null。
    it('discards a stale loadSchedule response after switching to another task (no cross-task leak)', async () => {
        // A 的 getSchedule 手动控制 resolve 时机，模拟「切完 task 才返回」。
        let resolveA: (v: any) => void = () => {};
        const aPending = new Promise((res) => { resolveA = res; });
        vi.mocked(api.getSchedule).mockReturnValueOnce(aPending as any);

        // detail A：有定时 schedule_id=900。
        vi.mocked(api.getSummaryDetail).mockResolvedValueOnce(
            baseDetail({ task_id: 1, schedule_id: 900 }) as any,
        );

        const page = makePage(1);
        // 启动 A 的加载：loadDetail 会 fire loadSchedule(900)，但 getSchedule 还未 resolve。
        await page.loadDetail();
        expect(api.getSchedule).toHaveBeenCalledWith(900);

        // 切到 task B（无定时）：模拟 props.taskId 变化 + componentDidUpdate 走 loadDetail。
        vi.mocked(api.getSummaryDetail).mockResolvedValueOnce(
            baseDetail({ task_id: 2, schedule_id: 0 }) as any,
        );
        (page as any).props = { taskId: 2 };
        page.componentDidUpdate({ taskId: 1 } as any);
        // 等 B 的 loadDetail 完成（同步清空 + getSummaryDetail resolve + 显式清空）。
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        // B 无定时 → scheduleItem 应为 null。
        expect((page.state as any).scheduleItem).toBeNull();

        // A 的 loadSchedule 现在才迟迟 resolve——修复后必须被丢弃。
        resolveA({ schedule_id: 900, is_active: true });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // 关键断言：A 的定时绝不能污染 B 的 state。
        expect((page.state as any).scheduleItem).toBeNull();
    });
});

// 回归：「无定时」总结新建定时改为一步式 createSchedule（scope='task' + task_id）。
// 后端 create 在 scope=task 时已在一个事务里原子完成「建定时 + 绑定 summary_task.schedule_id」，
// 前端不再走两步式（create 再 update 绑定），也不再有 B2 回滚（不会产生游离/孤儿定时）。
describe('SummaryDetailPage — new schedule: one-step create (scope=task)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('creates schedule in one step with scope=task + task_id, then loads it (no updateSchedule/deleteSchedule)', async () => {
        const NEW_ID = 321;
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: NEW_ID } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: NEW_ID, is_active: true } as any);

        const { Toast } = await import('@douyinfe/semi-ui');

        const page = makePage(1);
        // 无 scheduleItem → 进入「新建定时」分支。
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0 }),
            scheduleItem: null,
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        // 一步式 create：参数里直接带 scope='task' + task_id。
        expect(api.createSchedule).toHaveBeenCalledTimes(1);
        expect(api.createSchedule).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'task', task_id: 1 }),
        );
        // 不再有第二步绑定、也不再回滚。
        expect(api.updateSchedule).not.toHaveBeenCalled();
        expect(api.deleteSchedule).not.toHaveBeenCalled();
        // 拉取刚建并已绑定的定时回显。
        expect(api.getSchedule).toHaveBeenCalledWith(NEW_ID);
        expect(Toast.success).toHaveBeenCalled();
    });

    it('on create failure: only Toast.error, no rollback (no deleteSchedule)', async () => {
        vi.mocked(api.createSchedule).mockRejectedValue(new Error('一对一约束'));

        const { Toast } = await import('@douyinfe/semi-ui');

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0 }),
            scheduleItem: null,
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        // 后端事务原子回滚，前端不再产生游离定时 → 不调 deleteSchedule。
        expect(api.deleteSchedule).not.toHaveBeenCalled();
        expect(api.updateSchedule).not.toHaveBeenCalled();
        // 透出后端 message。
        expect(Toast.error).toHaveBeenCalled();
        expect(Toast.success).not.toHaveBeenCalled();
    });
});

// ─── V5（第2轮回炉）：多人写定时路径必须带 confirm_policy；确认入口按 confirm_policy 分两条路 ───
//
// 判定「多人」的数据源：详情页已加载的 this.state.members（api.getMembers 返回全体成员，
// 含 creator + 非 creator 协作成员），与本页其他多人判定（members.length>1）一致。
// 多人 → confirm_policy=1（CONFIRM）；单人 → 不传，走后端兜底。
const member = (uid: string) => ({ user_id: uid, user_name: uid, status: 'pending', submitted_at: null });

describe('SummaryDetailPage — V5 confirm_policy on schedule write paths', () => {
    beforeEach(() => vi.clearAllMocks());

    it('multi-person create (manual→scheduled) sends confirm_policy=1', async () => {
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: 1 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 1, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0 }),
            scheduleItem: null,
            members: [member('test-uid'), member('u_b')], // 多人
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        expect(api.createSchedule).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'task', task_id: 1, confirm_policy: 1 }),
        );
    });

    it('single-person create omits confirm_policy (backend fallback)', async () => {
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: 1 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 1, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0 }),
            scheduleItem: null,
            members: [member('test-uid')], // 单人
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        const arg = vi.mocked(api.createSchedule).mock.calls[0][0] as any;
        expect('confirm_policy' in arg).toBe(false);
    });

    it('multi-person update (edit/convert schedule) sends confirm_policy=1', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: 7 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 7, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 7 }),
            // 已存在 schedule（active）→ 进入 update 分支
            scheduleItem: { schedule_id: 7, is_active: true } as any,
            members: [member('test-uid'), member('u_b'), member('u_c')], // 多人
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        expect(api.updateSchedule).toHaveBeenCalledWith(
            7,
            expect.objectContaining({ scope: 'task', task_id: 1, confirm_policy: 1 }),
        );
    });

    it('single-person update omits confirm_policy', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: 7 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 7, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 7 }),
            scheduleItem: { schedule_id: 7, is_active: true } as any,
            members: [member('test-uid')], // 单人
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        const arg = vi.mocked(api.updateSchedule).mock.calls[0][1] as any;
        expect('confirm_policy' in arg).toBe(false);
    });
});

// finding 2：WAITING_CONFIRM 入口按 confirm_policy 区分 V5-schedule 级 vs 旧 task 级两条路。
describe('SummaryDetailPage — V5 vs legacy confirm routing (isV5ScheduleConfirm)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('V5 CONFIRM task (confirm_policy===1) → schedule-level path, NOT legacy task page', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 9, is_active: true, confirm_policy: 1 } as any,
        };
        expect((page as any).isV5ScheduleConfirm()).toBe(true);
    });

    it('legacy task-level confirm (no schedule) → keeps SummaryConfirmPage path', () => {
        const page = makePage(1);
        page.state = { ...(page.state as any), scheduleItem: null };
        expect((page as any).isV5ScheduleConfirm()).toBe(false);
    });

    it('schedule without CONFIRM policy (AUTO/0 or undefined) → legacy path', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 9, is_active: true, confirm_policy: 0 } as any,
        };
        expect((page as any).isV5ScheduleConfirm()).toBe(false);
    });

    // needsScheduleConfirm：当前用户（test-uid）在名单且未确认 → 需确认；已确认 → 不需。
    it('needsScheduleConfirm true when current user unconfirmed in participant_config', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: {
                schedule_id: 9, is_active: true, confirm_policy: 1,
                participant_config: { participants: [{ user_id: 'test-uid', confirmed: false }, { user_id: 'u_b', confirmed: true }] },
            } as any,
        };
        expect((page as any).needsScheduleConfirm()).toBe(true);
    });

    it('needsScheduleConfirm false when current user already confirmed', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: {
                schedule_id: 9, is_active: true, confirm_policy: 1,
                participant_config: { participants: [{ user_id: 'test-uid', confirmed: true }] },
            } as any,
        };
        expect((page as any).needsScheduleConfirm()).toBe(false);
    });
});

// ─── 竞态修复（第3轮回炉）：异步加载竞态消除 ───
//
// 背景：loadDetail 拿到 detail 后，loadSchedule 与 loadMembers 是两个独立的二次异步请求，
// 到达时间不确定。修复前：
//   - isMultiPerson() 只看 members.length>1 → members 未到时多人任务被误判单人 → 漏 confirm_policy。
//   - WAITING_CONFIRM 渲染只看 isV5ScheduleConfirm()(scheduleItem.confirm_policy===1) →
//     scheduleItem 未到时 V5 任务 fallback 到旧 SummaryConfirmPage。
// 修复：多人判定优先用同步随 detail 返回的 detail.participants；members 仅作兜底，且兜底时
//      members 加载中禁止保存；WAITING_CONFIRM 在 scheduleLoading 期间不 fallback 旧页。

describe('SummaryDetailPage — finding 1: 多人判定不被 members 二次异步竞态误判', () => {
    beforeEach(() => vi.clearAllMocks());

    // 关键窗口：members 尚未回填（[] 且 membersLoading=true），但 detail.participants 已含多人。
    // 修复前 isMultiPerson() 看 members.length>1 → false → 漏 confirm_policy=1。
    // 修复后 isMultiPerson() 优先看 detail.participants → true → 仍带 confirm_policy=1。
    it('multi-person create sends confirm_policy=1 even while members not loaded yet (detail.participants is the reliable source)', async () => {
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: 1 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 1, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({
                schedule_id: 0,
                participants: [{ user_id: 'test-uid' }, { user_id: 'u_b' }], // detail 已知多人
            }),
            scheduleItem: null,
            members: [],            // members 二次异步尚未回填
            membersLoading: true,   // 正在加载中
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        // 多人 → confirm_policy=1，未因 members 未到而误判单人。
        expect(api.createSchedule).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'task', task_id: 1, confirm_policy: 1 }),
        );
    });

    it('isMultiPerson prefers detail.participants over (empty) members', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ participants: [{ user_id: 'a' }, { user_id: 'b' }] }),
            members: [],
        };
        expect((page as any).isMultiPerson()).toBe(true);
    });

    it('isMultiPerson falls back to members when detail has no participants', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ participants: [] }),
            members: [member('a'), member('b')],
        };
        expect((page as any).isMultiPerson()).toBe(true);
    });
});

describe('SummaryDetailPage — finding 1 guard: members 加载中（且需兜底）禁止保存，避免误判单人', () => {
    beforeEach(() => vi.clearAllMocks());

    // 兜底路径（detail.participants 缺失）+ members 仍在加载 → 不能保存（不能把"加载中"当单人）。
    it('blocks save (no createSchedule) when falling back to members and membersLoading=true', async () => {
        const { Toast } = await import('@douyinfe/semi-ui');
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0, participants: [] }), // 无 participants → 需兜底
            scheduleItem: null,
            members: [],
            membersLoading: true,   // 加载中
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        // 加载中 → 阻止保存并提示，绝不发起写请求（否则可能漏 confirm_policy）。
        expect(api.createSchedule).not.toHaveBeenCalled();
        expect(api.updateSchedule).not.toHaveBeenCalled();
        expect(Toast.warning).toHaveBeenCalled();
    });

    // 区分"加载中" vs "确实单人"：membersLoading=false 且 members 确为单人 → 允许保存（不带 confirm_policy）。
    it('allows save when members loaded and genuinely single-person (not blocked)', async () => {
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: 1 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 1, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0, participants: [] }), // 无 participants → 兜底 members
            scheduleItem: null,
            members: [member('test-uid')], // 确实单人
            membersLoading: false,         // 已加载完成
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        expect(api.createSchedule).toHaveBeenCalledTimes(1);
        const arg = vi.mocked(api.createSchedule).mock.calls[0][0] as any;
        expect('confirm_policy' in arg).toBe(false); // 单人不带
    });

    it('isMembersReadyForSave: detail.participants 存在则始终就绪（不依赖 members 加载）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ participants: [{ user_id: 'a' }, { user_id: 'b' }] }),
            membersLoading: true, // 即便 members 加载中
        };
        expect((page as any).isMembersReadyForSave()).toBe(true);
    });

    it('isMembersReadyForSave: 兜底时 membersLoading=true → 未就绪', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ participants: [] }),
            membersLoading: true,
        };
        expect((page as any).isMembersReadyForSave()).toBe(false);
    });
});

// finding 2：WAITING_CONFIRM 入口在 scheduleItem 二次异步未到（scheduleLoading）期间，
// 不得 fallback 到旧 SummaryConfirmPage 按钮，避免 V5 CONFIRM 任务瞬时落旧 task 级确认流。
// 渲染分路决策抽到 waitingConfirmMode()：'loading' | 'v5' | 'legacy'。
// 'legacy' 是唯一会渲染旧 SummaryConfirmPage 按钮的分路。
describe('SummaryDetailPage — finding 2: scheduleLoading 期间 WAITING_CONFIRM 不落旧 SummaryConfirmPage', () => {
    beforeEach(() => vi.clearAllMocks());

    it('scheduleLoading=true (scheduleItem 未到) → mode=loading（不暴露任何确认入口，绝不 fallback 旧页）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: null,     // 二次异步尚未回填
            scheduleLoading: true,  // 加载中
        };
        expect((page as any).waitingConfirmMode()).toBe('loading');
    });

    it('scheduleLoading=true 即便已有 confirm_policy≠1 残留也不 legacy（先判加载态）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 1, confirm_policy: 0 } as any,
            scheduleLoading: true,
        };
        // 不能在加载中就用旧值判 legacy → 仍是 loading。
        expect((page as any).waitingConfirmMode()).toBe('loading');
    });

    it('scheduleLoading=false 且 V5 CONFIRM（confirm_policy=1）→ mode=v5（不渲染旧按钮）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 9, is_active: true, confirm_policy: 1 } as any,
            scheduleLoading: false,
        };
        expect((page as any).waitingConfirmMode()).toBe('v5');
    });

    it('scheduleLoading=false 且确无 schedule → mode=legacy（保留合法旧路径）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: null,      // 确无 schedule
            scheduleLoading: false,  // 已加载完成
        };
        expect((page as any).waitingConfirmMode()).toBe('legacy');
    });

    it('scheduleLoading=false 且非 V5（confirm_policy=0）→ mode=legacy', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 9, is_active: true, confirm_policy: 0 } as any,
            scheduleLoading: false,
        };
        expect((page as any).waitingConfirmMode()).toBe('legacy');
    });
});
