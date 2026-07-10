/**
 * DocTab — OCT-138 Stage B（postMessage token + 按登录身份显示 + 登出清态）
 *
 * 群 / 子区 / Space 详情页的"文档" tab，把 octo-docs-html 渲染的文档以
 * iframe 内嵌。挂载到聊天详情面板由后续 UI 单负责，本组件只保证：
 *   - 未登录（无 token）→ 空态，iframe 不挂，避免用未认证身份撞 doc 侧。
 *   - 登录后（有 token）→ iframe 挂载；onLoad 后向 iframe 发一次 octo:init，
 *     payload 只包含 token；targetOrigin 必须是宿主显式声明的 docOrigin，
 *     绝不 fallback 到 "*"（会把 token 广播给任何被劫持替换过的 doc）。
 *   - 登出 / token 轮换 → 通过 key=token 强制重挂载 iframe，旧文档实例
 *     拿到的 token 随实例一起销毁，不会残留在 iframe window 上。
 *
 * 与 OCT-150 login provider 对接：doc 侧 overlay 收到 octo:init 后 POST
 * /v1/auth/login 换 HttpOnly odoc_sid cookie；后续同源 fetch 走 cookie，
 * 不再需要每个请求带 header——这也是为什么本组件只做"一次握手"，不做
 * 请求头注入。宿主端别把 token 拼进 iframe src 或 fragment（Referer /
 * access log 泄漏面）；也别把 token 塞进 sessionStorage/localStorage
 * 给 doc 侧读——同源 storage 会漏给同源下其他 tab。
 *
 * FEAT-1 契约字段名 X-Octo-Token 在 doc 侧是 module token（OCT-144），
 * 不承载用户身份；本组件 postMessage payload 用 token 明字段，不复用
 * 那个 header 名，避免语义混淆——决策在 OCT-170 comment 记录。
 *
 * 沙盒：allow-scripts + allow-same-origin + allow-forms + allow-popups；
 * 显式不含 allow-top-navigation（防恶意 doc 用 top.location 劫持宿主 tab）。
 * vitest 里有反向断言锁这一条。
 */
import React, { useRef, useState } from "react";

export interface DocTabProps {
  /** doc 服务渲染 URL，如 https://d.example.com/d/<slug>/v/1 或首页 /me。 */
  src?: string;
  /**
   * doc 服务 origin（scheme+host+port），例如 "https://d.example.com"。
   * postMessage 的 targetOrigin 用它——宿主必须知道要跟谁握手。
   * 传空串或缺失 → 组件不发 postMessage（避免默认 "*" 广播 token）。
   */
  docOrigin?: string;
  /**
   * 当前 octo 登录 token。空/undefined ⇒ 空态；变化会触发 iframe 重挂载，
   * 保证旧 token 不会残留在 iframe window 上（登出/轮换清态）。
   */
  token?: string;
  /** 空态提示文本；调用方 i18n 后传入。 */
  emptyText?: string;
  /** 加载态提示文本。 */
  loadingText?: string;
  /** 附加类名。 */
  className?: string;
  /** 便于父组件测试探测的 title。 */
  title?: string;
}

/** postMessage 契约常量，doc 侧 overlay 也用同一个值监听。 */
export const OCTO_INIT_MESSAGE = "octo:init" as const;

/**
 * 文档 tab 面板：无 token 或无 src → 空态；否则挂 iframe，onLoad 后
 * 向 iframe 发一次 octo:init（若 docOrigin 已声明）。key=token 使
 * token 变化时组件重挂载，天然清态。
 */
const DocTab: React.FC<DocTabProps> = ({
  src,
  docOrigin,
  token,
  emptyText = "暂无文档",
  loadingText = "加载中…",
  className,
  title = "octo-doc",
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);

  const rootCls = ["wk-doc-tab", className].filter(Boolean).join(" ");

  // 未登录或宿主未给 src → 空态（不挂 iframe），避免匿名请求撞 doc。
  if (!src || !token) {
    return (
      <div
        className={`${rootCls} wk-doc-tab--empty`}
        data-testid="doc-tab-empty"
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div className={rootCls} data-testid="doc-tab">
      {loading && (
        <div className="wk-doc-tab__loading" data-testid="doc-tab-loading">
          {loadingText}
        </div>
      )}
      <iframe
        // key=token：token 变化触发 iframe 重挂载，旧文档实例连同其 token 一起销毁。
        key={token}
        ref={iframeRef}
        src={src}
        title={title}
        data-testid="doc-tab-iframe"
        className="wk-doc-tab__iframe"
        onLoad={() => {
          setLoading(false);
          postInit(iframeRef.current, docOrigin, token);
        }}
        // same-origin 是必需的：doc 页面 JS 通过同源 fetch 拿 capability cookie。
        // 不给 allow-top-navigation，避免恶意 doc 劫持宿主 tab。
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        // 禁用 legacy 属性：现代浏览器认 sandbox 就够，X-Frame-Options 由服务端出。
        loading="lazy"
      />
    </div>
  );
};

/**
 * 向 iframe 内部发一次 octo:init。docOrigin 缺失就静默 no-op——宁可让
 * doc 侧回退到匿名/空态，也不广播 token（targetOrigin "*" 是禁区）。
 */
function postInit(
  iframe: HTMLIFrameElement | null,
  docOrigin: string | undefined,
  token: string | undefined
): void {
  if (!iframe || !iframe.contentWindow) return;
  if (!token) return;
  const origin = (docOrigin || "").trim();
  if (!origin) return;
  iframe.contentWindow.postMessage(
    { type: OCTO_INIT_MESSAGE, token },
    origin
  );
}

export default DocTab;
export { DocTab };
