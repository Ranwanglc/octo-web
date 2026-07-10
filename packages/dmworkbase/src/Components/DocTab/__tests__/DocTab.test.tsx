import React from "react";
import ReactDOM from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import DocTab, { OCTO_INIT_MESSAGE } from "../DocTab";

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (!container) return;
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  container = null;
});

function renderInto(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(element, container);
  });
  return container;
}

/**
 * OCT-138 Stage B 契约。守护五件事，全部是"错了就漏 token / 漏鉴权"级别的坑：
 *   1. src 缺失 → 空态；src 有但 token 缺失（未登录/登出）也是空态：
 *      iframe 绝不能带匿名请求打 doc 侧。
 *   2. src+token 齐全 → iframe 挂上，src 逐字，未额外拼接。
 *   3. sandbox 允许 allow-scripts + allow-same-origin（doc 页面 JS 走同源
 *      fetch 拿 capability cookie），**不能**允许 allow-top-navigation
 *      （防恶意 doc 劫持宿主 tab）——Stage A 回归之守门，本单继承。
 *   4. onLoad 后 postMessage 触发：targetOrigin 必须是 docOrigin，
 *      **绝不为 "*"**；payload 形如 {type:"octo:init", token}；
 *      docOrigin 缺失 → 静默 no-op（宁可退空态，也不广播 token）。
 *   5. token 变化 → iframe 重挂载（React key 变），保证旧 token 不残留。
 */
describe("DocTab — OCT-138 Stage B (postMessage + login-gated)", () => {
  it("shows empty state when src is missing", () => {
    const html = renderToStaticMarkup(
      <DocTab emptyText="暂无文档" token="t1" docOrigin="https://d.example.com" />
    );
    expect(html).toContain("暂无文档");
    expect(html).not.toContain("<iframe");
  });

  it("shows empty state when token is missing even if src is set", () => {
    // 登出 / 未登录路径：宁可空态也不匿名撞 doc。
    const html = renderToStaticMarkup(
      <DocTab
        emptyText="请先登录"
        src="https://d.example.com/d/plan/v/1"
        docOrigin="https://d.example.com"
      />
    );
    expect(html).toContain("请先登录");
    expect(html).not.toContain("<iframe");
    expect(html).toContain('data-testid="doc-tab-empty"');
  });

  it("mounts an iframe with caller-provided src verbatim when token is present", () => {
    const src = "https://d.example.com/d/plan/v/1";
    const root = renderInto(
      <DocTab src={src} token="t1" docOrigin="https://d.example.com" title="octo-doc-tab" />
    );
    const iframe = root.querySelector(
      'iframe[data-testid="doc-tab-iframe"]'
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe(src);
    expect(iframe!.getAttribute("title")).toBe("octo-doc-tab");
    // token 绝不出现在 URL 里（禁 fragment / query 传 token）。
    expect(iframe!.getAttribute("src")!.includes("t1")).toBe(false);
  });

  it("locks the sandbox policy — same-origin allowed, top-nav denied", () => {
    // Stage A 回归之守门，继承到 Stage B。
    const html = renderToStaticMarkup(
      <DocTab
        src="https://d.example.com/me"
        token="t1"
        docOrigin="https://d.example.com"
      />
    );
    expect(html).toMatch(/sandbox="[^"]*allow-scripts[^"]*"/);
    expect(html).toMatch(/sandbox="[^"]*allow-same-origin[^"]*"/);
    expect(html).not.toMatch(/allow-top-navigation/);
  });

  it("shows a loading overlay before the iframe fires onLoad", () => {
    const root = renderInto(
      <DocTab
        src="https://d.example.com/me"
        token="t1"
        docOrigin="https://d.example.com"
      />
    );
    expect(
      root.querySelector('[data-testid="doc-tab-loading"]')
    ).not.toBeNull();
  });

  it("posts octo:init to the iframe with docOrigin as targetOrigin after load", () => {
    const src = "https://d.example.com/d/plan/v/1";
    const docOrigin = "https://d.example.com";
    const token = "octo-token-abc";
    const root = renderInto(<DocTab src={src} token={token} docOrigin={docOrigin} />);
    const iframe = root.querySelector(
      'iframe[data-testid="doc-tab-iframe"]'
    ) as HTMLIFrameElement;
    // contentWindow 在 jsdom 里可能是 null，用 defineProperty 打桩以捕获 postMessage 参数。
    const postMessage = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: { postMessage },
    });
    act(() => {
      iframe.dispatchEvent(new Event("load"));
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [payload, target] = postMessage.mock.calls[0];
    // targetOrigin 必须是 docOrigin，且**绝不为 "*"**（会把 token 广播给任何被替换过的 doc）。
    expect(target).toBe(docOrigin);
    expect(target).not.toBe("*");
    expect(payload).toEqual({ type: OCTO_INIT_MESSAGE, token });
  });

  it("does not post octo:init when docOrigin is missing (no wildcard fallback)", () => {
    const src = "https://d.example.com/me";
    const root = renderInto(<DocTab src={src} token="t1" />);
    const iframe = root.querySelector(
      'iframe[data-testid="doc-tab-iframe"]'
    ) as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: { postMessage },
    });
    act(() => {
      iframe.dispatchEvent(new Event("load"));
    });
    // 宿主未声明 docOrigin → 静默 no-op；**绝不**用 "*" 兜底。
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not post octo:init when docOrigin is only whitespace", () => {
    // trim 后为空要跟缺失同样处理，防呆。
    const root = renderInto(
      <DocTab src="https://d.example.com/me" token="t1" docOrigin="   " />
    );
    const iframe = root.querySelector(
      'iframe[data-testid="doc-tab-iframe"]'
    ) as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: { postMessage },
    });
    act(() => {
      iframe.dispatchEvent(new Event("load"));
    });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("remounts the iframe when token changes (logout / rotation clears state)", () => {
    const src = "https://d.example.com/d/plan/v/1";
    const docOrigin = "https://d.example.com";
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      ReactDOM.render(
        <DocTab src={src} token="t1" docOrigin={docOrigin} />,
        container
      );
    });
    const firstIframe = container.querySelector(
      'iframe[data-testid="doc-tab-iframe"]'
    );
    expect(firstIframe).not.toBeNull();

    act(() => {
      ReactDOM.render(
        <DocTab src={src} token="t2" docOrigin={docOrigin} />,
        container
      );
    });
    const secondIframe = container.querySelector(
      'iframe[data-testid="doc-tab-iframe"]'
    );
    expect(secondIframe).not.toBeNull();
    // key=token 触发重挂载：DOM 节点身份变了。
    expect(secondIframe).not.toBe(firstIframe);
  });

  it("falls back to empty state when token clears (logout mid-session)", () => {
    const src = "https://d.example.com/d/plan/v/1";
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      ReactDOM.render(
        <DocTab
          src={src}
          token="t1"
          docOrigin="https://d.example.com"
          emptyText="请先登录"
        />,
        container
      );
    });
    expect(container.querySelector('iframe[data-testid="doc-tab-iframe"]')).not.toBeNull();

    act(() => {
      ReactDOM.render(
        <DocTab
          src={src}
          token={undefined}
          docOrigin="https://d.example.com"
          emptyText="请先登录"
        />,
        container
      );
    });
    // 登出：iframe 卸载 → 空态挂上，doc 侧旧 token 随 iframe 一起销毁。
    expect(container.querySelector('iframe[data-testid="doc-tab-iframe"]')).toBeNull();
    expect(container.querySelector('[data-testid="doc-tab-empty"]')).not.toBeNull();
  });
});
