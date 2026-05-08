/**
 * displayName - 展示名解析工具
 *
 * dmwork-web YUJ-359 / GH #1121：接入 OCTO 实名认证后，所有需要展示用户
 * 名称的位置都应该经过本工具，以统一处理「真实姓名覆盖昵称」的优先级。
 *
 * 优先级（从高到低）：
 *   1. `remark`        —— 查看者本地给对方设置的备注名（好友备注）
 *   2. `real_name`     —— 仅当 `realname_verified === true` 时生效
 *   3. `name`          —— 用户自设的昵称（默认）
 *
 * 字段来源：
 *   - `users/{uid}` profile API 返回扁平字段 realname_verified / real_name
 *   - 前端 Convert.userToChannelInfo 会把它们 spread 到 `channelInfo.orgData`
 *     并同步计算 `orgData.displayName` 供消费方直接读取
 *
 * 备注：
 *   - 实名认证是默认属性，UI 层面**不**在每个展示点加「✓ 已实名」勾图标
 *     （只在个人资料页展示一次，见 GH #1121 「不在范围」章节）
 *   - 任何新的名称展示点（聊天气泡 / 群成员 / @mention / 已读列表 ...）
 *     都应当消费 `orgData.displayName` 或本工具，而非直接读 `user.name`
 */
export interface DisplayNameUser {
    name?: string | null;
    real_name?: string | null;
    realname_verified?: boolean | number | null;
    remark?: string | null;
}

function nonEmpty(v: string | null | undefined): v is string {
    return typeof v === "string" && v.length > 0;
}

export function displayName(user: DisplayNameUser | null | undefined): string {
    if (!user) return "";
    if (nonEmpty(user.remark)) return user.remark;
    // realname_verified 兼容 bool / 1 / 0
    const verified = user.realname_verified === true || user.realname_verified === 1;
    if (verified && nonEmpty(user.real_name)) return user.real_name;
    return nonEmpty(user.name) ? user.name : "";
}

/**
 * 判断某个 profile 是否已完成实名认证。
 * orgData 场景通常用 realname_verified === 1；以后端决定值的真假逻辑为准。
 */
export function isRealnameVerified(user: DisplayNameUser | null | undefined): boolean {
    if (!user) return false;
    return user.realname_verified === true || user.realname_verified === 1;
}

/**
 * 从群成员（Subscriber）对象里提取展示名。
 *
 * Subscriber 的 `name` / `remark` 是平铺字段，`real_name` / `realname_verified`
 * 在 orgData 里（后端 enrich）。本函数把两边的字段合并后交给 displayName
 * 统一按 remark → real_name(verified) → name 的优先级返回。
 *
 * 用于群消息发送者名字的主路径（比 Person ChannelInfo 命中率高得多，
 * 特别是仅在群里出现、没开过 1v1 的用户）。
 */
export interface SubscriberLike {
    name?: string | null;
    remark?: string | null;
    orgData?: { real_name?: string | null; realname_verified?: boolean | number | null } | null;
}

export function subscriberDisplayName(sub: SubscriberLike | null | undefined): string {
    if (!sub) return "";
    return displayName({
        name: sub.name,
        remark: sub.remark,
        real_name: sub.orgData?.real_name,
        realname_verified: sub.orgData?.realname_verified,
    });
}
