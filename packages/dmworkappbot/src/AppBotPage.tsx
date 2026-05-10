import React, { useEffect, useMemo, useRef, useState } from "react"
import { Channel, ChannelTypePerson, ChannelInfo, WKSDK } from "wukongimjssdk"
import { WKApp, Conversation, SpaceService } from "@octo/base"
import "./AppBotPage.css"

interface AppBotInfo {
  id: string
  uid: string
  display_name: string
  description: string
  avatar: string
  scope: "platform" | "space"
}

type LoadState = "loading" | "ready" | "error"

// Default bot avatar as SVG data URI — used as fallback when the
// /users/{uid}/avatar endpoint has not had an avatar uploaded yet
// (the endpoint returns a generated default, but we keep this for
// offline/error scenarios).
const BOT_DEFAULT_AVATAR_DATA_URI = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">'
  + '<rect width="80" height="80" rx="16" fill="#667eea"/>'
  + '<rect x="14" y="26" width="52" height="40" rx="10" stroke="white" stroke-width="3" fill="rgba(255,255,255,0.2)"/>'
  + '<circle cx="30" cy="46" r="5" fill="white"/>'
  + '<circle cx="50" cy="46" r="5" fill="white"/>'
  + '<path d="M32 56c2 4 5 6 8 6s6-2 8-6" stroke="white" stroke-width="3" stroke-linecap="round" fill="none"/>'
  + '<line x1="40" y1="12" x2="40" y2="26" stroke="white" stroke-width="3" stroke-linecap="round"/>'
  + '<circle cx="40" cy="10" r="5" fill="white"/>'
  + '</svg>'
)

/** Lightweight error toast — self-removing DOM element, no external dependency. */
function showErrorToast(message: string) {
  const el = document.createElement("div")
  Object.assign(el.style, {
    position: "fixed",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "10000",
    padding: "8px 16px",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: "500",
    color: "#dc2626",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    opacity: "0",
    transition: "opacity 200ms ease",
  })
  el.textContent = message
  document.body.appendChild(el)
  requestAnimationFrame(() => { el.style.opacity = "1" })
  setTimeout(() => {
    el.style.opacity = "0"
    setTimeout(() => el.remove(), 200)
  }, 3000)
}

/** Bot chat header — renders directly from bot data, bypasses SDK channelInfo */
function BotChatHeader({ bot }: { bot: AppBotInfo }) {
  const avatarSrc = WKApp.shared.avatarUser(bot.uid)
  return (
    <div className="appbot-chat-header">
      <div className="appbot-chat-header-avatar">
        <img src={avatarSrc} alt={bot.display_name} onError={(e) => { (e.target as HTMLImageElement).src = BOT_DEFAULT_AVATAR_DATA_URI }} />
      </div>
      <div className="appbot-chat-header-name">{bot.display_name}</div>
    </div>
  )
}

export default function AppBotPage() {
  const [bots, setBots] = useState<AppBotInfo[]>([])
  const [state, setState] = useState<LoadState>("loading")
  const [spaceName, setSpaceName] = useState("")
  const [keyword, setKeyword] = useState("")
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let stale = false
    let requestId = 0

    const loadData = async () => {
      const thisRequest = ++requestId
      setState("loading")
      try {
        const spaceId = WKApp.shared.currentSpaceId
        const params = spaceId ? { param: { space_id: spaceId } } : undefined
        const res = await WKApp.apiClient.get("/app_bot/available", params)
        if (stale || thisRequest !== requestId) return
        const items = Array.isArray(res) ? res.filter((b: AppBotInfo) => b && b.uid && b.id) : []
        setBots(items)
        setState("ready")
      } catch (err) {
        console.warn("[AppBotPage] Failed to load bots:", err)
        if (stale || thisRequest !== requestId) return
        setBots([])
        setState("error")
      }
    }

    const resolveSpaceName = async () => {
      const spaceId = WKApp.shared.currentSpaceId
      if (!spaceId) { if (!stale) setSpaceName(""); return }
      try {
        const spaces = await SpaceService.shared.getMySpaces()
        if (stale) return
        const found = spaces?.find((s: { space_id: string; name?: string }) => s.space_id === spaceId)
        setSpaceName(found?.name || "")
      } catch { if (!stale) setSpaceName("") }
    }

    loadData()
    resolveSpaceName()

    const handler = () => {
      isSelectingRef.current = false
      setSelectedUid(null)
      WKApp.routeRight.popToRoot()
      loadData()
      resolveSpaceName()
    }
    WKApp.mittBus.on("space-changed", handler)
    return () => { stale = true; WKApp.mittBus.off("space-changed", handler) }
  }, [reloadTick])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return bots
    return bots.filter((b) =>
      (b.display_name || "").toLowerCase().includes(kw) ||
      (b.description || "").toLowerCase().includes(kw)
    )
  }, [bots, keyword])

  const platformBots = useMemo(() => filtered.filter((b) => b.scope === "platform"), [filtered])
  const spaceBots = useMemo(() => filtered.filter((b) => b.scope === "space"), [filtered])

  const isSelectingRef = useRef(false)

  const handleSelect = async (bot: AppBotInfo) => {
    if (isSelectingRef.current) return
    isSelectingRef.current = true
    try {
      // Ensure friend relationship with bot (opt-in consent).
      // This is idempotent — already-friends returns OK immediately.
      await WKApp.apiClient.post("/app_bot/apply", { robot_uid: bot.uid })

      setSelectedUid(bot.uid)

      const channel = new Channel(bot.uid, ChannelTypePerson)

      // Write bot identity to channelManager FIRST — Conversation component
      // reads this for message row avatars/names. Must be set before any
      // component renders or triggers fetchChannelInfo.
      const info = new ChannelInfo()
      info.channel = channel
      info.title = bot.display_name
      // Use relative path for ChannelInfo.logo — avatarChannel() / getImageURL()
      // will prepend the API base URL. Writing a full URL here causes double-prefix.
      info.logo = `users/${bot.uid}/avatar`
      info.orgData = { displayName: bot.display_name, robot: 1, name: bot.display_name }
      WKSDK.shared().channelManager.setChannleInfoForCache(info)

      // Ensure conversation exists in SDK
      const convMgr = WKSDK.shared().conversationManager
      if (!convMgr.findConversation(channel) && convMgr.createEmptyConversation) {
        convMgr.createEmptyConversation(channel)
      }

      // Render bot chat: our header + Conversation (messages + input only)
      WKApp.routeRight.replaceToRoot(
        <div key={channel.getChannelKey()} className="appbot-chat-wrap">
          <BotChatHeader bot={bot} />
          <Conversation channel={channel} />
        </div>
      )
    } catch (err) {
      console.error("[AppBotPage] handleSelect failed:", err)
      showErrorToast("无法连接到该应用，请稍后重试")
    } finally {
      isSelectingRef.current = false
    }
  }

  const renderItem = (bot: AppBotInfo) => {
    const isActive = selectedUid === bot.uid
    return (
      <div
        key={bot.id}
        className={`appbot-list-item ${isActive ? "appbot-list-item-active" : ""}`}
        onClick={() => handleSelect(bot)}
      >
        <div className="appbot-list-avatar">
          <img src={WKApp.shared.avatarUser(bot.uid)} alt={bot.display_name} onError={(e) => { (e.target as HTMLImageElement).src = BOT_DEFAULT_AVATAR_DATA_URI }} />
        </div>
        <div className="appbot-list-info">
          <div className="appbot-list-name">{bot.display_name}</div>
          <div className="appbot-list-desc">{bot.description || "应用 Bot"}</div>
        </div>
      </div>
    )
  }

  const renderSection = (title: string, list: AppBotInfo[]) => {
    if (list.length === 0) return null
    return (
      <div className="appbot-list-section" key={title}>
        <div className="appbot-list-section-title">{title}</div>
        {list.map(renderItem)}
      </div>
    )
  }

  return (
    <div className="appbot-page">
      <div className="appbot-page-header">
        <div className="appbot-page-title">应用</div>
        <input
          type="search"
          className="appbot-search-input"
          placeholder="搜索"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      <div className="appbot-page-list">
        {state === "loading" && (
          <div className="appbot-list-status">
            <div className="appbot-spinner" />
            <span>加载中...</span>
          </div>
        )}
        {state === "error" && (
          <div className="appbot-list-status">
            <span>加载失败</span>
            <button className="appbot-retry-btn" onClick={() => setReloadTick((t) => t + 1)}>重试</button>
          </div>
        )}
        {state === "ready" && filtered.length === 0 && (
          <div className="appbot-list-status">
            <span>{keyword ? "未找到匹配的应用" : "暂无可用应用"}</span>
          </div>
        )}
        {state === "ready" && (
          <>
            {renderSection("平台应用", platformBots)}
            {renderSection(spaceName ? `空间应用 · ${spaceName}` : "空间应用", spaceBots)}
          </>
        )}
      </div>
    </div>
  )
}
