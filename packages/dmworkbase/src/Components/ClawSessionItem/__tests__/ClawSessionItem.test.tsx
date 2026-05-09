import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ClawSessionItem from "../index";

describe("ClawSessionItem", () => {
  const mockSession = {
    key: "octo:c_pipi_lux_01",
    status: "done" as const,
    channel: "Octo",
    party: "罗敬为 · 皮皮虾(私聊)",
    botName: "皮皮虾",
    botId: "pipixia_bot",
    model: "mlamp/claude-opus-4-7",
    ctxUsed: 48200,
    ctxMax: 1000000,
    sessionId: "sess_octo_7f3a2b18e",
    lastMsg: "帮我用糗米写一份 OctoPush 的 V0.0.3 发布公告",
  };

  describe("AC-5: 展示对话方、模型、上下文、最近消息", () => {
    it("应该正确展示所有关键信息", () => {
      render(<ClawSessionItem session={mockSession} />);

      // 验证对话方
      expect(screen.getByTestId("claw-session-party")).toHaveTextContent(
        "罗敬为 · 皮皮虾(私聊)"
      );

      // 验证模型
      expect(screen.getByTestId("claw-session-model")).toHaveTextContent(
        "mlamp/claude-opus-4-7"
      );

      // 验证 SESSION ID
      expect(screen.getByTestId("claw-session-id")).toHaveTextContent(
        "sess_octo_7f3a2b18e"
      );

      // 验证 Bot 信息
      expect(screen.getByTestId("claw-session-bot")).toHaveTextContent("皮皮虾");
      expect(screen.getByTestId("claw-session-bot")).toHaveTextContent("@pipixia_bot");

      // 验证上下文进度条文本
      expect(screen.getByTestId("claw-context-bar-text")).toHaveTextContent(
        "48.2K / 1000K (5%)"
      );
    });

    it("应该显示正确的渠道标签", () => {
      render(<ClawSessionItem session={mockSession} />);

      const channelChip = screen.getByTestId("claw-channel-chip");
      expect(channelChip).toHaveTextContent("Octo");
      expect(channelChip).toHaveClass("wk-channel-octo");
    });

    it("应该显示正确的 session key", () => {
      render(<ClawSessionItem session={mockSession} />);

      expect(screen.getByTestId("claw-session-key")).toHaveTextContent(
        "octo:c_pipi_lux_01"
      );
    });
  });

  describe("AC-6: 状态视觉标记（running=绿 / done=灰 / failed|killed|timeout=红）", () => {
    it("status=running 时应该显示 RUNNING 徽章", () => {
      const runningSession = { ...mockSession, status: "running" as const };
      render(<ClawSessionItem session={runningSession} />);

      const badge = screen.getByTestId("claw-status-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("RUNNING");
      expect(badge).toHaveClass("wk-status-badge--running");
    });

    it("status=done 时应该显示 DONE 徽章", () => {
      const doneSession = { ...mockSession, status: "done" as const };
      render(<ClawSessionItem session={doneSession} />);

      const badge = screen.getByTestId("claw-status-badge");
      expect(badge).toHaveTextContent("DONE");
      expect(badge).toHaveClass("wk-status-badge--done");
    });

    it("status=failed 时应该显示 FAILED 徽章", () => {
      const failedSession = { ...mockSession, status: "failed" as const };
      render(<ClawSessionItem session={failedSession} />);

      const badge = screen.getByTestId("claw-status-badge");
      expect(badge).toHaveTextContent("FAILED");
      expect(badge).toHaveClass("wk-status-badge--failed");
    });

    it("status=killed 时应该显示 KILLED 徽章", () => {
      const killedSession = { ...mockSession, status: "killed" as const };
      render(<ClawSessionItem session={killedSession} />);

      const badge = screen.getByTestId("claw-status-badge");
      expect(badge).toHaveTextContent("KILLED");
      expect(badge).toHaveClass("wk-status-badge--failed");
    });

    it("status=timeout 时应该显示 TIMEOUT 徽章", () => {
      const timeoutSession = { ...mockSession, status: "timeout" as const };
      render(<ClawSessionItem session={timeoutSession} />);

      const badge = screen.getByTestId("claw-status-badge");
      expect(badge).toHaveTextContent("TIMEOUT");
      expect(badge).toHaveClass("wk-status-badge--failed");
    });

    it("status=running 时卡片应该有 wk-session-card--running 类", () => {
      const runningSession = { ...mockSession, status: "running" as const };
      render(<ClawSessionItem session={runningSession} />);

      const card = screen.getByTestId("claw-session-card");
      expect(card).toHaveClass("wk-session-card--running");
    });

    it("status=done 时卡片应该有 wk-session-card--done 类", () => {
      const doneSession = { ...mockSession, status: "done" as const };
      render(<ClawSessionItem session={doneSession} />);

      const card = screen.getByTestId("claw-session-card");
      expect(card).toHaveClass("wk-session-card--done");
    });

    it("status=failed 时卡片应该有 wk-session-card--failed 类", () => {
      const failedSession = { ...mockSession, status: "failed" as const };
      render(<ClawSessionItem session={failedSession} />);

      const card = screen.getByTestId("claw-session-card");
      expect(card).toHaveClass("wk-session-card--failed");
    });
  });

  describe("AC-7: 点击表头展开/收起", () => {
    it("初始状态应该是折叠的", () => {
      render(<ClawSessionItem session={mockSession} />);

      const card = screen.getByTestId("claw-session-card");
      expect(card).toHaveClass("collapsed");

      // 主体内容应该不可见
      expect(screen.queryByTestId("claw-session-body")).not.toBeInTheDocument();
    });

    it("点击头部应该切换折叠状态", () => {
      render(<ClawSessionItem session={mockSession} />);

      const head = screen.getByTestId("claw-session-head");
      const card = screen.getByTestId("claw-session-card");

      // 第一次点击：展开
      fireEvent.click(head);
      expect(card).not.toHaveClass("collapsed");
      expect(screen.getByTestId("claw-session-body")).toBeInTheDocument();

      // 第二次点击：折叠
      fireEvent.click(head);
      expect(card).toHaveClass("collapsed");
      expect(screen.queryByTestId("claw-session-body")).not.toBeInTheDocument();
    });

    it("展开/收起时箭头图标应该旋转（通过 CSS 类验证）", () => {
      render(<ClawSessionItem session={mockSession} />);

      const head = screen.getByTestId("claw-session-head");
      const card = screen.getByTestId("claw-session-card");

      // 初始折叠，card 有 collapsed 类（CSS 会旋转箭头）
      expect(card).toHaveClass("collapsed");

      // 点击展开时 card 没有 collapsed 类
      fireEvent.click(head);
      expect(card).not.toHaveClass("collapsed");
    });
  });

  describe("AC-8: 上下文进度条 > 70% 显示警告色", () => {
    it("上下文占用 <= 70% 时，进度条应该是正常色", () => {
      // 50% 占用
      const normalSession = { ...mockSession, ctxUsed: 500000, ctxMax: 1000000 };
      render(<ClawSessionItem session={normalSession} />);

      const fill = screen.getByTestId("claw-context-bar-fill");
      expect(fill).not.toHaveClass("warn");
      expect(fill).toHaveStyle({ width: "50%" });
    });

    it("上下文占用 > 70% 时，进度条应该显示警告色", () => {
      // 85% 占用
      const highCtxSession = { ...mockSession, ctxUsed: 850000, ctxMax: 1000000 };
      render(<ClawSessionItem session={highCtxSession} />);

      const fill = screen.getByTestId("claw-context-bar-fill");
      expect(fill).toHaveClass("warn");
      expect(fill).toHaveStyle({ width: "85%" });
    });

    it("上下文占用正好 70% 时，进度条不应该显示警告色", () => {
      const session70 = { ...mockSession, ctxUsed: 700000, ctxMax: 1000000 };
      render(<ClawSessionItem session={session70} />);

      const fill = screen.getByTestId("claw-context-bar-fill");
      expect(fill).not.toHaveClass("warn");
    });

    it("上下文占用 71% 时，进度条应该显示警告色", () => {
      const session71 = { ...mockSession, ctxUsed: 710000, ctxMax: 1000000 };
      render(<ClawSessionItem session={session71} />);

      const fill = screen.getByTestId("claw-context-bar-fill");
      expect(fill).toHaveClass("warn");
    });

    it("进度条文本应该正确显示百分比", () => {
      const session = { ...mockSession, ctxUsed: 148200, ctxMax: 1000000 };
      render(<ClawSessionItem session={session} />);

      // 148200 / 1000000 = 14.82% -> 15% (rounded)
      expect(screen.getByTestId("claw-context-bar-text")).toHaveTextContent(
        "148.2K / 1000K (15%)"
      );
    });
  });

  describe("不同渠道的样式", () => {
    it("Discord 渠道应该有正确的样式类", () => {
      const discordSession = { ...mockSession, channel: "Discord" };
      render(<ClawSessionItem session={discordSession} />);

      const chip = screen.getByTestId("claw-channel-chip");
      expect(chip).toHaveClass("wk-channel-discord");
    });

    it("飞书渠道应该有正确的样式类", () => {
      const feishuSession = { ...mockSession, channel: "飞书" };
      render(<ClawSessionItem session={feishuSession} />);

      const chip = screen.getByTestId("claw-channel-chip");
      expect(chip).toHaveClass("wk-channel-飞书");
    });

    it("Localhost 渠道应该有正确的样式类", () => {
      const localhostSession = { ...mockSession, channel: "Localhost" };
      render(<ClawSessionItem session={localhostSession} />);

      const chip = screen.getByTestId("claw-channel-chip");
      expect(chip).toHaveClass("wk-channel-localhost");
    });
  });

  describe("边界情况", () => {
    it("上下文占用为 0 时应该正确显示", () => {
      const zeroSession = { ...mockSession, ctxUsed: 0 };
      render(<ClawSessionItem session={zeroSession} />);

      expect(screen.getByTestId("claw-context-bar-fill")).toHaveStyle({ width: "0%" });
      expect(screen.getByTestId("claw-context-bar-text")).toHaveTextContent(
        "0.0K / 1000K (0%)"
      );
    });

    it("上下文占用为 100% 时应该正确显示", () => {
      const fullSession = { ...mockSession, ctxUsed: 1000000, ctxMax: 1000000 };
      render(<ClawSessionItem session={fullSession} />);

      expect(screen.getByTestId("claw-context-bar-fill")).toHaveStyle({ width: "100%" });
      expect(screen.getByTestId("claw-context-bar-fill")).toHaveClass("warn");
    });

    it("长文本消息应该正常显示", () => {
      const longMsgSession = {
        ...mockSession,
        lastMsg:
          "这是一条非常非常长的消息，用来测试组件在处理超长文本时是否能正常显示，不会溢出或破坏布局。这条消息包含了很多内容，可能会换行显示。",
      };
      render(<ClawSessionItem session={longMsgSession} />);

      expect(screen.getByTestId("claw-session-msg")).toHaveTextContent(
        longMsgSession.lastMsg
      );
    });
  });
});
