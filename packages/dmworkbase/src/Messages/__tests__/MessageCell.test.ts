import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const channelManager = vi.hoisted(() => ({
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addSubscriberChangeListener: vi.fn(),
  removeSubscriberChangeListener: vi.fn(),
  getChannelInfo: vi.fn(),
  fetchChannelInfo: vi.fn(),
}));

vi.mock("wukongimjssdk", () => {
  const ChannelTypePerson = 1;
  const ChannelTypeGroup = 2;
  const TaskStatus = {
    success: "success",
    fail: "fail",
    cancel: "cancel",
  };
  class Channel {
    channelID: string;
    channelType: number;

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }

    isEqual(other?: Channel) {
      return (
        !!other &&
        this.channelID === other.channelID &&
        this.channelType === other.channelType
      );
    }
  }
  class MediaMessageContent {
    file?: File;
    remoteUrl?: string;
  }
  const sdk = {
    shared: () => ({
      channelManager,
      taskManager: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    }),
  };
  return {
    default: sdk,
    WKSDK: sdk,
    Channel,
    ChannelTypePerson,
    ChannelTypeGroup,
    TaskStatus,
    MediaMessageContent,
  };
});

vi.mock("../../App", () => ({
  default: {
    dataSource: {
      commonDataSource: {
        getFileURL: (url: string) => url,
      },
    },
    mittBus: {
      emit: vi.fn(),
    },
  },
}));

vi.mock("../../bridge/message/useFileMessageUI", () => ({
  getFileMessageUI: () => ({
    row: {
      isSend: false,
      isContinue: false,
      isSelected: false,
      showAvatar: false,
      avatarUrl: "",
      senderName: "Alice",
      timestamp: "10:00",
    },
  }),
}));

vi.mock("../../Service/messageSelection", () => ({
  isMessageSelectable: () => true,
}));

vi.mock("../../ui/message/MessageRow", () => ({
  default: (props: { children?: React.ReactNode }) => props.children,
}));

vi.mock("../../Components/WKModal", () => ({
  default: () => null,
}));

vi.mock("../Text/MarkdownContent", () => ({
  default: () => null,
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { MessageCell } from "../MessageCell";
import { FileCell, isAudio } from "../File";

function createCell(channelID = "group-1") {
  const message = {
    fromUID: "user-1",
    channel: new Channel(channelID, ChannelTypeGroup),
  };
  const cell = new MessageCell({ message, context: {} } as any);
  cell.setState = vi.fn() as any;
  return cell;
}

function createFileCell(content: Record<string, unknown>) {
  const message = {
    fromUID: "user-1",
    channel: new Channel("group-1", ChannelTypeGroup),
    content,
    messageID: 1,
    messageSeq: 1,
    message: {},
    checked: false,
  };
  const context = {
    editOn: () => false,
    isContextMenuOpen: () => false,
    showContextMenus: vi.fn(),
    checkeMessage: vi.fn(),
    onTapAvatar: vi.fn(),
    showUser: vi.fn(),
    getActivePreviewMessageId: () => undefined,
  };
  const cell = new FileCell({ message, context } as any);
  (cell as any).context = { t: (key: string) => key };
  cell.setState = vi.fn() as any;
  return cell;
}

function containsElementType(node: unknown, type: string): boolean {
  if (!React.isValidElement(node)) return false;
  if (node.type === type) return true;
  const { children } = node.props as { children?: React.ReactNode };
  return React.Children.toArray(children).some((child) =>
    containsElementType(child, type)
  );
}

describe("MessageCell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelManager.getChannelInfo.mockReturnValue(undefined);
  });

  it("subscribes group member changes and re-renders matching group messages", () => {
    const cell = createCell();

    cell.componentDidMount();

    const listener = channelManager.addSubscriberChangeListener.mock
      .calls[0][0] as (channel: Channel) => void;
    listener(new Channel("other-group", ChannelTypeGroup));
    expect(cell.setState).not.toHaveBeenCalled();

    listener(new Channel("group-1", ChannelTypeGroup));
    expect(cell.setState).toHaveBeenCalledWith({});

    cell.componentWillUnmount();
    expect(channelManager.removeSubscriberChangeListener).toHaveBeenCalledWith(
      listener
    );
  });
});

describe("FileCell audio messages", () => {
  it("detects supported audio extensions from extension or file name", () => {
    for (const ext of ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"]) {
      expect(isAudio(ext)).toBe(true);
      expect(isAudio("file", `track.${ext}`)).toBe(true);
    }

    for (const ext of ["pdf", "png", "txt"]) {
      expect(isAudio(ext)).toBe(false);
      expect(isAudio("file", `document.${ext}`)).toBe(false);
    }
  });

  it("renders an inline audio element for audio files", () => {
    const cell = createFileCell({
      extension: "mp3",
      name: "voice.mp3",
      size: 2048,
      url: "https://example.com/voice.mp3",
    });

    expect(containsElementType(cell.render(), "audio")).toBe(true);
  });

  it("falls back to the generic file branch for unsafe audio URLs", () => {
    const cell = createFileCell({
      extension: "mp3",
      name: "voice.mp3",
      size: 2048,
      url: "httpx://example.com/voice.mp3",
    });

    expect(containsElementType(cell.render(), "audio")).toBe(false);
  });

  it("keeps non-audio files on the generic file branch", () => {
    const cell = createFileCell({
      extension: "pdf",
      name: "report.pdf",
      size: 2048,
      url: "https://example.com/report.pdf",
    });

    expect(containsElementType(cell.render(), "audio")).toBe(false);
  });
});
