import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { setWKApp, WKSDK } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import type { HtmlCreationDraft } from './createHtmlTask.ts'

// Replace ONLY the heavy Conversation with a marker; keep the rest of the seam (Channel,
// ChannelTypePerson, t) real. The marker surfaces the channel it was built with, the auto-sent
// task text + requestId, and exposes the compose-state callback so the shell's status line is
// testable without a live IM channel.
let lastConversationProps: {
  channel: { channelID: string; channelType: number }
  initialCompose?: { requestId: string; text: string; files: File[]; autoSend: boolean }
  onInitialComposeStateChange?: (r: string, s: string, reason?: string) => void
  onMessageSent?: () => void
} | null = null

vi.mock('../octoweb/index.ts', async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>
  return {
    ...actual,
    Conversation: (props: typeof lastConversationProps) => {
      lastConversationProps = props
      return (
        <div data-testid="conversation">
          <span data-testid="conv-channel">{props!.channel.channelID}</span>
          <span data-testid="conv-channel-type">{props!.channel.channelType}</span>
          <span data-testid="conv-request-id">{props!.initialCompose?.requestId}</span>
          <span data-testid="conv-text">{props!.initialCompose?.text}</span>
          <span data-testid="conv-autosend">{String(props!.initialCompose?.autoSend)}</span>
          <span data-testid="conv-files">{props!.initialCompose?.files.length}</span>
        </div>
      )
    },
  }
})

import { DocsBotConversation } from './DocsBotConversation.tsx'

const draft = (over: Partial<HtmlCreationDraft> = {}): HtmlCreationDraft => ({
  requestId: 'req-abc',
  replyChannelId: 'u_self',
  botUid: 'bot_x',
  botName: 'Publisher',
  description: 'A launch page',
  files: [],
  spaceId: 's_1',
  publishBaseUrl: 'https://octo.example/docs-html/',
  ...over,
})

describe('DocsBotConversation', () => {
  beforeEach(() => {
    lastConversationProps = null
    ;(WKSDK as unknown as { resetMessageListeners(): void }).resetMessageListeners()
    setWKApp(createMockWKApp())
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('builds a Person channel for the bot uid and renders Conversation', () => {
    render(<DocsBotConversation draft={draft()} onClose={() => {}} />)
    expect(screen.getByTestId('conversation')).toBeTruthy()
    expect(screen.getByTestId('conv-channel').textContent).toBe('bot_x')
    // ChannelTypePerson === 1.
    expect(screen.getByTestId('conv-channel-type').textContent).toBe('1')
  })

  it('passes a one-shot auto-send initialCompose carrying the fixed task text + files', () => {
    const f = new File(['x'], 'ref.png', { type: 'image/png' })
    render(<DocsBotConversation draft={draft({ files: [f] })} onClose={() => {}} />)
    expect(screen.getByTestId('conv-request-id').textContent).toBe('req-abc')
    expect(screen.getByTestId('conv-autosend').textContent).toBe('true')
    expect(screen.getByTestId('conv-files').textContent).toBe('1')
    const text = screen.getByTestId('conv-text').textContent || ''
    expect(text).toContain('[Octo HTML 创建任务]')
    expect(text).toContain('request_id: req-abc')
    expect(text).toContain('channel_id: u_self')
    expect(text).not.toContain('channel_id: bot_x')
    expect(text).toContain('publish_base_url: https://octo.example/docs-html/')
    expect(text).toContain('message_base_url: http://192.168.201.162:8190')
    // No token anywhere in the auto-sent text.
    expect(text.toLowerCase()).not.toContain('authorization')
  })

  it('shows the bot name and the "create HTML with bot" context in the header', () => {
    render(<DocsBotConversation draft={draft()} onClose={() => {}} />)
    expect(screen.getByText('Publisher')).toBeTruthy()
    expect(screen.getByText('docs.list.htmlCreate.chatContext')).toBeTruthy()
  })

  it('reflects prepared / sent / failed compose states (does not fake bot progress)', () => {
    render(<DocsBotConversation draft={draft()} onClose={() => {}} />)
    // No status until the compose reports one.
    expect(screen.queryByRole('status')).toBeNull()
    // Sent, then failed with a reason.
    act(() => lastConversationProps!.onInitialComposeStateChange!('req-abc', 'sent'))
    act(() => lastConversationProps!.onInitialComposeStateChange!('req-abc', 'failed', 'send-failed'))
    // The status region flips to the failed styling hook.
    const status = document.querySelector('.octo-docs-bot-chat-status')
    expect(status?.getAttribute('data-state')).toBe('failed')
  })

  it('close button returns to docs (calls onClose) without deleting the DM', () => {
    const onClose = vi.fn()
    render(<DocsBotConversation draft={draft()} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('docs.list.htmlCreate.close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('forwards onMessageSent to Conversation', () => {
    const onMessageSent = vi.fn()
    render(<DocsBotConversation draft={draft()} onClose={() => {}} onMessageSent={onMessageSent} />)
    lastConversationProps!.onMessageSent!()
    expect(onMessageSent).toHaveBeenCalledTimes(1)
  })

  const validResult = {
    schema: 'html.publish.result',
    version: 1,
    request_id: 'req-abc',
    status: 'published',
    registered: true,
    doc_id: 'doc-123',
    slug: 'launch-page',
    doc_version: 1,
    share_url: 'https://octo.example/d/launch-page/v/1',
  }

  const emit = (over: Record<string, unknown> = {}) => {
    ;(WKSDK as unknown as { emitMessage(message: unknown): void }).emitMessage({
      contentType: 17,
      channel: { channelID: 'bot_x', channelType: 1 },
      fromUID: 'bot_x',
      content: { octo_result: validResult },
      ...over,
    })
  }

  it('accepts one strict result, auto-opens once, and retains the manual button', () => {
    const onResult = vi.fn()
    const onAutoOpenResult = vi.fn()
    const onOpenResult = vi.fn()
    render(
      <DocsBotConversation
        draft={draft()}
        onClose={() => {}}
        onResult={onResult}
        onAutoOpenResult={onAutoOpenResult}
        onOpenResult={onOpenResult}
      />,
    )
    act(() => emit())
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onAutoOpenResult).toHaveBeenCalledTimes(1)
    expect(onAutoOpenResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ doc_id: 'doc-123', slug: 'launch-page' }),
    )
    fireEvent.click(screen.getByText('docs.list.htmlCreate.stateGenerated'))
    expect(onOpenResult).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['wrong message type', { contentType: 1 }],
    ['wrong channel type', { channel: { channelID: 'bot_x', channelType: 2 } }],
    ['wrong current channel', { channel: { channelID: 'bot_y', channelType: 1 } }],
    ['wrong selected bot sender', { fromUID: 'bot_y' }],
    ['wrong request', { content: { octo_result: { ...validResult, request_id: 'req-other' } } }],
    ['wrong schema', { content: { octo_result: { ...validResult, schema: 'other' } } }],
    ['wrong version', { content: { octo_result: { ...validResult, version: 2 } } }],
    ['not registered', { content: { octo_result: { ...validResult, registered: false } } }],
    ['invalid doc id', { content: { octo_result: { ...validResult, doc_id: '../bad' } } }],
    ['invalid slug', { content: { octo_result: { ...validResult, slug: 'bad/slug' } } }],
    ['invalid pre-decoded result', { content: { octoResult: { ...validResult, registered: false } } }],
  ])('rejects %s', (_label, message) => {
    const onResult = vi.fn()
    const onAutoOpenResult = vi.fn()
    render(
      <DocsBotConversation
        draft={draft()}
        onClose={() => {}}
        onResult={onResult}
        onAutoOpenResult={onAutoOpenResult}
      />,
    )
    act(() => emit(message))
    expect(onResult).not.toHaveBeenCalled()
    expect(onAutoOpenResult).not.toHaveBeenCalled()
  })

  it('restores a completed result without reopening and keeps the manual button', () => {
    const onResult = vi.fn()
    const onOpenResult = vi.fn()
    render(
      <DocsBotConversation
        draft={draft()}
        initialResult={validResult}
        autoOpenResult={false}
        onClose={() => {}}
        onResult={onResult}
        onOpenResult={onOpenResult}
      />,
    )
    expect(screen.getByText('docs.list.htmlCreate.stateGenerated')).toBeTruthy()
    act(() => emit())
    expect(onResult).not.toHaveBeenCalled()
    expect(onOpenResult).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.stateGenerated'))
    expect(onOpenResult).toHaveBeenCalledTimes(1)
  })

  it('deduplicates repeated results and removes the WK listener after success/unmount', () => {
    const onResult = vi.fn()
    const onAutoOpenResult = vi.fn()
    const view = render(
      <DocsBotConversation
        draft={draft()}
        onClose={() => {}}
        onResult={onResult}
        onAutoOpenResult={onAutoOpenResult}
      />,
    )
    const sdk = WKSDK as unknown as { messageListenerCount(): number }
    expect(sdk.messageListenerCount()).toBe(1)
    act(() => {
      emit()
      emit()
      emit({
        content: {
          octo_result: {
            ...validResult,
            doc_id: 'doc-456',
            doc_version: 2,
            slug: 'different-page',
          },
        },
      })
    })
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onAutoOpenResult).toHaveBeenCalledTimes(1)
    expect(sdk.messageListenerCount()).toBe(0)
    view.unmount()
    expect(sdk.messageListenerCount()).toBe(0)
  })

  it('removes the WK listener when unmounted before any result arrives', () => {
    const view = render(<DocsBotConversation draft={draft()} onClose={() => {}} />)
    const sdk = WKSDK as unknown as { messageListenerCount(): number }
    expect(sdk.messageListenerCount()).toBe(1)
    view.unmount()
    expect(sdk.messageListenerCount()).toBe(0)
  })
})
