import { describe, expect, it } from "vitest"
import { shouldClearDraftAfterSend } from "../draftLifecycle"

describe("shouldClearDraftAfterSend", () => {
    it("clears the draft snapshot that belonged to the sent message", () => {
        expect(shouldClearDraftAfterSend({
            sentDraftSnapshot: "hello",
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: false,
        })).toBe(true)
    })

    it("does not clear a live draft typed while the send is pending", () => {
        expect(shouldClearDraftAfterSend({
            sentDraftSnapshot: "hello",
            liveDraft: "new draft",
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: false,
        })).toBe(false)
    })

    it("does not clear a newer draft saved while the send is pending", () => {
        expect(shouldClearDraftAfterSend({
            sentDraftSnapshot: "hello",
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: true,
            latestSavedDraft: "new draft",
        })).toBe(false)
    })

    it("allows the clear when the only later save is an empty editor", () => {
        expect(shouldClearDraftAfterSend({
            sentDraftSnapshot: "hello",
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: true,
            latestSavedDraft: "",
        })).toBe(true)
    })

    it("clears an edited restored draft after it is sent", () => {
        expect(shouldClearDraftAfterSend({
            sentDraftSnapshot: "hello!",
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            liveDraft: "",
            draftSavedAfterSend: false,
        })).toBe(true)
    })

    it("does not clear a remote draft updated while the send is pending", () => {
        expect(shouldClearDraftAfterSend({
            sentDraftSnapshot: "hello",
            remoteDraft: "remote new draft",
            remoteDraftAtSend: "hello",
            liveDraft: "",
            draftSavedAfterSend: false,
        })).toBe(false)
    })
})
