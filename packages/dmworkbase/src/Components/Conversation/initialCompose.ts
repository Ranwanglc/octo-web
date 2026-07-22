// One-shot initial-compose consumer for Conversation (plan Task 4 / §5.1–§5.3).
//
// This is the pure, framework-free core of "load a text + attachments into the composer once and
// (optionally) auto-send exactly once". Conversation owns the wiring (when MessageInput is ready,
// prop updates, the consumed-set), and delegates the actual atomic load+send decision here so it
// can be unit tested without React or a live IM channel.
//
// SAFETY invariants enforced here:
//   - Consume a requestId at MOST once (the caller passes a `consumed` Set; we add to it the
//     instant we begin an atomic load, before any await, so a re-render / remount can't double-fire).
//   - Never overwrite an existing user draft or pending attachments — refuse, report 'failed', keep
//     the original draft (§5.2).
//   - Strict order restoreDraft → addPendingAttachments → send (§5.1). An attachment validation
//     error aborts BEFORE send, keeping the typed task text so the user can retry (§5.3).
//   - NEVER bypass MessageInput to sendMessage directly (upload/ACK/failure-retention live there).

export interface InitialCompose {
  requestId: string
  text: string
  files: File[]
  autoSend: boolean
}

/** State callback contract mirrored onto ConversationProps.onInitialComposeStateChange. */
export type InitialComposeState = 'prepared' | 'sent' | 'failed'

/**
 * The minimal composer surface the consumer drives. Conversation implements this over its
 * MessageInput context + addPendingAttachments; tests supply a fake.
 */
export interface ComposeHost {
  /** True once MessageInput's onContext has fired (context + addAttachment fn are wired). */
  isReady(): boolean
  /** Current composer text (a non-empty value means the user already has a draft). */
  currentDraftText(): string
  /** Number of files already staged for send (a non-zero value blocks the auto-load). */
  pendingAttachmentCount(): number
  /** Replace the composer content with the task text (MessageInput.restoreDraft). */
  restoreDraft(text: string): void
  /** Stage attachments; returns an error string on validation failure, null on success. */
  addPendingAttachments(files: File[]): string | null
  /**
   * Trigger send through MessageInput (never a direct sendMessage). May be async.
   *
   * Resolves to the real send outcome: `true`/void when the compose was actually sent,
   * `false` (or `{ editorConsumed: false }`) when the send was rejected and the draft was
   * preserved (a FAILED send, not a success). The consumer maps a falsy/editorConsumed:false
   * result to 'failed' so a preserved-draft send is never mis-reported as 'sent'.
   */
  send(): void | boolean | { editorConsumed: boolean } | Promise<void | boolean | { editorConsumed: boolean }>
}

export interface ConsumeResult {
  /** Whether the requestId was consumed on this call (added to the consumed set). */
  consumed: boolean
  /** The terminal/interim state emitted, if any (undefined when it just waited for readiness). */
  state?: InitialComposeState
  reason?: string
}

/**
 * Attempt to consume `compose` exactly once against `host`.
 *
 * Returns immediately (consumed:false, no state) when the host isn't ready yet or the requestId is
 * already in `consumed` — the caller retries readiness on the next MessageInput onContext / prop
 * update. On a real attempt it marks the requestId consumed BEFORE loading (double-fire guard),
 * then runs the atomic load; the returned promise resolves after send settles.
 */
export async function tryConsumeInitialCompose(
  compose: InitialCompose | undefined,
  host: ComposeHost,
  consumed: Set<string>,
  emit?: (requestId: string, state: InitialComposeState, reason?: string) => void,
): Promise<ConsumeResult> {
  if (!compose) return { consumed: false }
  if (consumed.has(compose.requestId)) return { consumed: false }
  // Wait for MessageInput to be ready; do NOT consume yet so a later ready-retry still fires.
  if (!host.isReady()) return { consumed: false }

  // Refuse to clobber an existing draft / staged attachments (§5.2). Report failed, keep draft.
  const hasDraft = host.currentDraftText().trim().length > 0
  const hasPending = host.pendingAttachmentCount() > 0
  if (hasDraft || hasPending) {
    consumed.add(compose.requestId)
    const reason = 'draft-conflict'
    emit?.(compose.requestId, 'failed', reason)
    return { consumed: true, state: 'failed', reason }
  }

  // Begin the atomic load: mark consumed BEFORE any await so a re-render can't re-enter (§5, risk 1).
  consumed.add(compose.requestId)

  // 1) task text.
  host.restoreDraft(compose.text)

  // 2) attachments. A validation failure aborts before send and keeps the text (§5.3).
  if (compose.files.length > 0) {
    const err = host.addPendingAttachments(compose.files)
    if (err) {
      emit?.(compose.requestId, 'failed', err)
      return { consumed: true, state: 'failed', reason: err }
    }
  }

  // Prefill-only mode: never auto-send.
  if (!compose.autoSend) {
    emit?.(compose.requestId, 'prepared')
    return { consumed: true, state: 'prepared' }
  }

  // 3) send through MessageInput. The existing send flow owns upload/ACK and draft retention; we
  // read its real outcome to distinguish a genuine send from a rejected/preserved draft:
  //   - true / void        → sent
  //   - false              → send-rejected (draft kept) → 'failed'
  //   - { editorConsumed }  → use editorConsumed; false → 'failed'
  //   - throws             → 'failed'
  try {
    const result = await host.send()
    const sent = interpretSendResult(result)
    if (!sent) {
      const reason = 'send-rejected'
      emit?.(compose.requestId, 'failed', reason)
      return { consumed: true, state: 'failed', reason }
    }
    emit?.(compose.requestId, 'sent')
    return { consumed: true, state: 'sent' }
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'send-failed'
    emit?.(compose.requestId, 'failed', reason)
    return { consumed: true, state: 'failed', reason }
  }
}

/**
 * Map the loose `host.send()` return into a boolean "was the compose actually sent?".
 *
 * void / true            → sent (legacy void-returning send path keeps working).
 * false                  → not sent (draft preserved = send rejected).
 * { editorConsumed }     → the editorConsumed flag.
 * anything else (null)   → not sent (defensive).
 */
export function interpretSendResult(
  result: void | boolean | { editorConsumed: boolean } | undefined,
): boolean {
  if (result === undefined || result === null) return true
  if (typeof result === 'boolean') return result
  if (typeof result === 'object' && 'editorConsumed' in result) {
    return result.editorConsumed === true
  }
  return true
}
