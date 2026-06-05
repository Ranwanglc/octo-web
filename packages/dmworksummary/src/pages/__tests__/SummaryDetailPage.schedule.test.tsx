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
    return {
        Button: Passthrough,
        Typography,
        Tag: Passthrough,
        Avatar: Passthrough,
        Spin: Passthrough,
        Modal: Passthrough,
        Banner: Passthrough,
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
