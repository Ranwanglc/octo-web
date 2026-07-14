// octo-doc read-only comment rail + "让 AI 处理" entry (env ring 2b).
//
// Overlay-only: this panel sits BESIDE the sanitized read-only content (mounted at the 2b
// EXTENSION POINT in HtmlDocView). It NEVER injects into the sanitized HTML and never makes the
// doc editable — comments/replies are its own controls in its own rail. Data flows through the
// octo-doc backend (htmlDocComments), not the same-origin Yjs backend. UI structure mirrors
// ../comments/CommentPanel.tsx conventions but the data layer is independent.
//
// TRIGGER MODE C (explicit): posting a comment does NOT invoke the AI. Only a deliberate
// "让 AI 处理" click forwards an instruction to chat (openDocForward). The two are decoupled.

import { useCallback, useEffect, useState } from 'react'
import { canForwardToChat, openDocForward, t } from '../octoweb/index.ts'
import {
  createComment,
  listComments,
  type Anchor,
  type OctoDocCommentThread,
} from './htmlDocComments.ts'
import { buildAgentInstruction, type AgentInstructionDoc } from './htmlDocAnchor.ts'

export interface HtmlDocCommentPanelProps {
  docId: string
  space: string
  role?: string
  slug: string
  version: string
  /**
   * A pending selection anchor lifted from HtmlDocView's selection watcher. When set, the
   * composer pre-targets it (划词评论); cleared once the comment posts. null = doc-level note.
   */
  pendingAnchor?: Anchor | null
  /** Explicitly switches the composer back to a doc-level comment. */
  onClearPendingAnchor?: () => void
  /** Called after a successful post so the view can clear the floating "评论" affordance. */
  onPosted?: () => void
}

/** Short human label for how a comment is anchored (element aid / selected text / doc-level). */
function anchorLabel(anchor: Anchor | null | undefined): string {
  if (!anchor) return t('docs.comment.anchorDoc')
  if (anchor.kind === 'element') return `<${anchor.label ?? 'el'}> #${anchor.aid}`
  return `“${anchor.text}”`
}

export function HtmlDocCommentPanel({
  docId,
  space,
  slug,
  version,
  pendingAnchor,
  onClearPendingAnchor,
  onPosted,
}: HtmlDocCommentPanelProps) {
  const [threads, setThreads] = useState<OctoDocCommentThread[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setThreads(await listComments(slug, version))
      setError(null)
    } catch {
      setError(t('docs.state.error'))
    }
  }, [slug, version])

  useEffect(() => {
    void reload()
  }, [reload])

  async function submit() {
    if (draft.trim() === '') return
    setBusy(true)
    try {
      await createComment(slug, {
        text: draft.trim(),
        version,
        anchor: pendingAnchor ?? null,
      })
      setDraft('')
      onPosted?.()
      await reload()
    } catch {
      setError(t('docs.state.error'))
    } finally {
      setBusy(false)
    }
  }

  // "让 AI 处理" bridge availability (feature #511 seam). Gated: the standalone /d/ page has no
  // host IM surface, so we disable the control there instead of rendering a dead button.
  const canForward = canForwardToChat()
  const instructionDoc: AgentInstructionDoc = { docId, slug, space, version }

  function handleWithAI(thread: OctoDocCommentThread) {
    if (!canForward) return
    const { title, link } = buildAgentInstruction(instructionDoc, thread)
    // Reuse the existing forward bridge; host owns the WKSDK send. canGrant=false: this is an
    // instruction to the AI, not an access-grant flow.
    openDocForward({ docId, title, link, canGrant: false })
  }

  const forwardDisabledReason = canForward ? undefined : t('docs.forward.grantDisabledReason')

  return (
    <aside className="octo-html-doc-comments" data-testid="html-doc-comment-panel" aria-label={t('docs.comment.title')}>
      <div className="octo-html-doc-comments-head">{t('docs.comment.title')}</div>

      {error && (
        <div className="octo-html-doc-comments-error" role="alert">
          {error}
        </div>
      )}

      <ul className="octo-html-doc-comments-list">
        {threads.map((thread) => (
          <li key={thread.id} className="octo-html-doc-comment" data-testid="html-doc-comment">
            <div className="octo-html-doc-comment-anchor" title={anchorLabel(thread.anchor)}>
              {anchorLabel(thread.anchor)}
            </div>
            <p className="octo-html-doc-comment-text">{thread.text}</p>
            {thread.replies?.map((r) => (
              <p key={r.id} className="octo-html-doc-comment-reply">
                {r.text}
              </p>
            ))}
            <button
              type="button"
              className="octo-tb-btn octo-html-doc-comment-ai"
              disabled={!canForward}
              title={forwardDisabledReason}
              onClick={() => handleWithAI(thread)}
            >
              {t('docs.comment.handleWithAI')}
            </button>
          </li>
        ))}
      </ul>

      <div className="octo-html-doc-comments-compose">
        <div className="octo-html-doc-comments-target" data-testid="pending-anchor">
          {pendingAnchor ? (
            <>
              <span>
                {t('docs.comment.targetAnchor')}: {anchorLabel(pendingAnchor)}
              </span>
              <button
                type="button"
                className="octo-tb-btn octo-html-doc-comments-clear"
                onClick={onClearPendingAnchor}
              >
                {t('docs.comment.clearAnchor')}
              </button>
            </>
          ) : (
            <span>{t('docs.comment.targetDoc')}</span>
          )}
        </div>
        <textarea
          className="octo-comment-input"
          value={draft}
          placeholder={t('docs.comment.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="octo-tb-btn"
          disabled={busy || draft.trim() === ''}
          onClick={submit}
        >
          {t('docs.comment.send')}
        </button>
      </div>
    </aside>
  )
}
