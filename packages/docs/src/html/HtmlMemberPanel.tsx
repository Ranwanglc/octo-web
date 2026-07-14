import { useCallback, useEffect, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { t } from '../octoweb/index.ts'
import { MemberPicker } from '../members/MemberPicker.tsx'
import { listGrants, addGrant, removeGrant, type HtmlGrant } from './htmlGrantsApi.ts'

// Member panel for HTML docs. Reuses the rich-doc MemberPicker (selection UI) and
// the shared octo-member CSS so it looks/behaves identically, but talks to the
// octo-doc grants backend instead of the Yjs members API. Distinct from the rich
// MemberPanel so that backend stays untouched (zero regression there).
//
// octo-doc grants are reader-only today (author = the creator, shown as a locked
// owner row). No invite links / access-requests — those are rich-doc features not
// backed here — so this panel omits both sections by design.

export function HtmlMemberPanel({
  slug,
  space,
  creatorUid,
  currentUid,
  onClose,
}: {
  slug: string
  /** Space id for the member picker roster. */
  space?: string
  /** The doc creator (author). Shown as a locked owner row; never removable. */
  creatorUid?: string
  /** The viewer's uid; management is offered only to the creator (author). */
  currentUid?: string
  onClose?: () => void
}) {
  const [grants, setGrants] = useState<HtmlGrant[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const canManage = !!creatorUid && !!currentUid && creatorUid === currentUid

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setGrants(await listGrants(slug))
    } catch {
      setError(t('docs.member.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    if (canManage) void refresh()
  }, [canManage, refresh])

  // Only the author manages members; a non-author sees nothing (parity with the
  // rich MemberPanel's canManage gate).
  if (!canManage) return null

  // reader is the only grantable role today; MemberPicker returns a Role but we
  // pin it to reader before calling the backend.
  async function onAdd(uids: string[]) {
    setError(null)
    setBusy(true)
    try {
      for (const uid of uids) await addGrant(slug, uid.trim(), 'reader')
      await refresh()
    } catch {
      setError(t('docs.member.errorAdd'))
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(uid: string) {
    setError(null)
    try {
      await removeGrant(slug, uid)
      await refresh()
    } catch {
      setError(t('docs.member.errorRemove'))
    }
  }

  // Existing uids (for the picker's "already added" pins): every granted uid plus
  // the creator. The creator is never a candidate (hidden) and never removable.
  const existingUids = new Set<string>(grants.map((g) => g.uid))
  if (creatorUid) existingUids.add(creatorUid)

  const rows: HtmlGrant[] = []
  if (creatorUid) rows.push({ uid: creatorUid, role: 'author', source: 'owner' })
  for (const g of grants) {
    if (g.source !== 'owner' && g.uid !== creatorUid) rows.push(g)
  }

  return (
    <section className="octo-member-panel">
      <div className="octo-member-row">
        <h3 style={{ flex: 1, margin: 0 }}>{t('docs.member.manage')}</h3>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            {t('docs.member.close')}
          </button>
        )}
      </div>

      <div className="octo-member-section">
        <h4 className="octo-member-subtitle">{t('docs.member.addMember')}</h4>
        <MemberPicker
          space={space}
          existingUids={existingUids}
          hideUids={new Set([currentUid, creatorUid].filter(Boolean) as string[])}
          onAdd={(uids: string[], _role: Role) => onAdd(uids)}
          busy={busy}
        />
        {error && <p className="octo-member-error">{error}</p>}
      </div>

      <div className="octo-member-section">
        <h4 className="octo-member-subtitle">{t('docs.member.currentMembers')}</h4>
        {loading && <p className="octo-loading">{t('docs.member.loading')}</p>}
        {!loading && rows.length === 0 && (
          <p className="octo-member-empty">{t('docs.member.empty')}</p>
        )}
        {rows.map((m) => {
          const isOwner = m.source === 'owner'
          return (
            <div className="octo-member-row" key={m.uid}>
              <span className="octo-uid">
                {m.uid}{' '}
                {isOwner && <span className="octo-owner-badge">{t('docs.member.ownerBadge')}</span>}
                {!isOwner && <small style={{ color: 'var(--octo-muted)' }}> · {t('docs.role.reader')}</small>}
              </span>
              {!isOwner && (
                <button
                  type="button"
                  className="octo-tb-btn"
                  onClick={() => onRemove(m.uid)}
                >
                  {t('docs.member.remove')}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
