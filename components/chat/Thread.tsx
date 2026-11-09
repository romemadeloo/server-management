"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useRealtime } from "@/components/providers/PusherProvider";
import { usePresence } from "@/components/providers/PresenceProvider";
import { useUnread } from "@/components/providers/UnreadProvider";
import { conversationChannel, userChannel } from "@/lib/realtime/channels";
import { getPusher, realtimeHeaders } from "@/lib/realtime/client";
import { applyMessageDeletion, dropConfirmedPending, mergeMessages } from "@/lib/chat/merge";
import {
  MESSAGE_COUNTER_THRESHOLD,
  MESSAGE_MAX_LENGTH,
  messageLength,
} from "@/lib/chat/limits";
import { applyReactionToggle, mergeReactionGroup, type ReactionGroup } from "@/lib/chat/reactions";
import { formatDateTime } from "@/lib/shared/format";
import { readReceipts, seenByLabel } from "@/lib/chat/receipts";
import { HoverAction, ReactionPicker, ReactionPills } from "./Reactions";
import { GroupDialog } from "./GroupDialog";
import {
  AttachButton,
  AttachmentGrid,
  ComposerAttachments,
  ImageLightbox,
} from "./Attachments";
import { ReplyComposerChip, ReplyQuote } from "./Reply";
import { LinkPreviewCard, MessageText } from "./MessageText";
import { useUploads } from "./useUploads";
import {
  ACCEPT_ATTRIBUTE,
  ATTACHMENT_MAX_PER_MESSAGE,
  attachmentSummary,
} from "@/lib/chat/attachments";
import {
  adjustMentions,
  filterMentionCandidates,
  insertMention,
  mentionQueryAt,
  plainText,
  serializeMentions,
  type DraftMention,
} from "@/lib/chat/mentions";
import { MentionPicker } from "./MentionPicker";
import { PersonCard } from "./PersonCard";
import type { AttachmentView } from "@/lib/db/queries/attachments";
import type { ConversationSummary, MessageRow, ReplyPreview } from "@/lib/db/queries/chat";
import type { ConversationEvents } from "@/lib/realtime/events";

/**
 * One conversation.
 *
 * ── Why this component owns its state ──
 *
 * Everything else in this app renders from Postgres in a Server Component and
 * repaints via router.refresh(). A message list cannot: refetching a paginated
 * thread on every incoming message is slow, and re-rendering it wholesale
 * destroys scroll position, text selection, and whatever is half-typed in the
 * composer. So this holds an append-only list of its own.
 *
 * The server's data is still authoritative. `initialMessages` is MERGED in when
 * it changes rather than ignored, so a refresh can only ever add — it cannot
 * erase something already on screen.
 *
 * ── Sent messages arrive from the POST, not from the event ──
 *
 * Mutations send this tab's socket id, so Pusher excludes it from its own
 * fan-out. That is deliberate (no echo, no double render), and it means the
 * sender must reconcile from its own response. Everyone else gets `message.new`.
 */

interface Pending {
  clientMsgId: string;
  body: string;
  failed: boolean;
  /**
   * The optimistic bubble carries its files and its quote too.
   *
   * Without these, a reply with two screenshots renders as a bare line of text for
   * the length of the round trip and then visibly rearranges itself into something
   * taller when the real row lands. Neither is a guess: the attachments are
   * already uploaded by the time Send is pressed, and the quote came from the
   * server when the reply was started.
   */
  attachments: AttachmentView[];
  replyTo: ReplyPreview | null;
}

const TYPING_PING_MS = 3000;
const TYPING_EXPIRY_MS = 4000;
/** Treat "within this many pixels of the bottom" as being at the bottom. */
const STICK_THRESHOLD_PX = 120;

export function Thread({
  conversation,
  viewerId,
  initialMessages,
  initialHasMore,
  initialReadUpTo,
}: {
  /**
   * The whole conversation, not a handful of fields.
   *
   * It used to be `conversationId` + `title` + `members`, which was enough for a
   * DM — a DM's title and membership never change. A group's do, and both the
   * header and the manage dialog need `kind`, `viewerRole` and each member's role
   * to decide what to render. Passing the summary the page already loaded is
   * cheaper than three more props that would have to be kept in step with it.
   */
  conversation: ConversationSummary;
  viewerId: string;
  initialMessages: MessageRow[];
  initialHasMore: boolean;
  /** Each other member's last-read message id, from chat_members. */
  initialReadUpTo: Record<string, number>;
}) {
  const router = useRouter();
  const { state: connectionState } = useRealtime();
  const { online, tracking } = usePresence();
  const { clear: clearUnread, bump: bumpConversation } = useUnread();

  /**
   * A local copy of the conversation, so a rename or a membership change repaints
   * the header immediately rather than after a server round trip.
   *
   * The server's copy is still authoritative and replaces this whenever it
   * changes — the effect below — exactly as `initialMessages` does for the list.
   */
  const [detail, setDetail] = useState<ConversationSummary>(conversation);
  const [managing, setManaging] = useState(false);
  /** Bumped on `members.changed`, so an open manage dialog refetches. */
  const [membersVersion, setMembersVersion] = useState(0);

  const conversationId = conversation.id;
  const title = detail.title;
  const members = detail.members;
  const isGroup = detail.kind === "group";

  useEffect(() => {
    setDetail(conversation);
  }, [conversation]);

  const [confirmed, setConfirmed] = useState<MessageRow[]>(initialMessages);
  const [pending, setPending] = useState<Pending[]>([]);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState<Record<string, number>>({});
  /**
   * Each member's read position. A watermark per person, not a receipt per
   * message (ADR-006) — so "read" is answered by comparing one number against a
   * message id rather than by looking up a row.
   */
  const [readUpTo, setReadUpTo] = useState<Record<string, number>>(initialReadUpTo);
  const [missed, setMissed] = useState(0);
  /**
   * A state mirror of the `atBottom` ref.
   *
   * The ref stays, because the scroll-follow effect and the incoming-message
   * handler read it synchronously mid-event and cannot wait for a render. But a
   * ref changing re-runs nothing, and two things have to REACT to the scroll
   * position: the read watermark below, and the jump-to-latest button.
   *
   * That was a real bug, and it needed two messages arriving close together:
   *
   *   1. message A lands; the read effect schedules its 600 ms timer
   *   2. the smooth scroll to A begins, and part-way through `onScroll` measures a
   *      distance over the threshold and sets the ref to false
   *   3. message B lands, `newestId` changes, the effect re-runs — its cleanup
   *      cancels A's pending timer, and the fresh run reads the ref as false and
   *      schedules NOTHING
   *   4. the scroll settles, the ref goes back to true, and nothing re-runs
   *
   * The conversation was then never reported read, so its badge stayed while it
   * sat open on screen. In state, step 4 re-runs the effect and the read lands.
   */
  const [atBottomView, setAtBottomView] = useState(true);

  /** The message being replied to, or null. Server-produced, so the quote above
   *  the composer is the same quote the bubble will show. */
  const [replyingTo, setReplyingTo] = useState<ReplyPreview | null>(null);
  /** The image the lightbox is showing. */
  const [lightbox, setLightbox] = useState<AttachmentView | null>(null);
  /**
   * Jumping to a quoted message, which is a two-step problem: the target may not
   * be loaded. `jumpTarget` is the id being hunted; the effect below pages
   * backwards until it appears and then scrolls to it. `highlightId` is the brief
   * flash afterwards, so the eye can find it among fifty similar bubbles.
   */
  const [jumpTarget, setJumpTarget] = useState<number | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [jumpFailed, setJumpFailed] = useState(false);

  /** The member whose details card is open, from tapping a mention. */
  const [personCardId, setPersonCardId] = useState<string | null>(null);
  /** Which candidate the Arrow keys have landed on. Reset whenever the query
   *  changes, so typing another letter always starts back at the best match. */
  const [mentionIndex, setMentionIndex] = useState(0);
  /** Where the caret is, tracked so `mentionQueryAt` knows what is being typed.
   *  Read from the textarea on every interaction rather than guessed. */
  const [caret, setCaret] = useState(0);
  /**
   * Which spans of the draft are really mentions.
   *
   * The draft itself holds PLAIN text — "@Super Admin", never the stored
   * `@[Super Admin](uuid)` form, because the composer is a textarea and whatever
   * is in it is what the person watching sees. These ranges are what turn that
   * plain text back into tokens at send time. See lib/chat/mentions.ts.
   */
  const [draftMentions, setDraftMentions] = useState<DraftMention[]>([]);

  const composer = useRef<HTMLTextAreaElement>(null);

  const uploads = useUploads(conversationId);

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastTypingPing = useRef(0);
  const readReported = useRef(0);
  const hasConnected = useRef(false);

  // Keyed on the conversation's kind, not on its member count. A group that
  // happens to be down to two people is still a group: it has a name, a photo and
  // an owner, and rendering the other person's face and presence for it would be
  // showing something that is not what this conversation is.
  const dmPartner = isGroup ? undefined : members.find((m) => m.id !== viewerId);

  // ---------- mentions ----------

  /**
   * The `@…` currently being typed, or null.
   *
   * Only in groups. A DM has exactly one other person in it — mentioning them is
   * addressing the whole conversation, so the dropdown would be a step that
   * conveys nothing.
   */
  const mentionQuery = useMemo(
    () => (isGroup ? mentionQueryAt(draft, caret) : null),
    [isGroup, draft, caret],
  );

  /**
   * Who may be mentioned: this conversation's members, minus yourself.
   *
   * Mentioning yourself is allowed to render but never notifies (the server drops
   * it), so offering it in the picker would only invite an action with no effect.
   *
   * The list is the *members*, which is what enforces "no non-members" on this
   * side — and the server re-checks membership before writing a mention row, so a
   * hand-crafted request gets the same answer.
   */
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return [];
    return filterMentionCandidates(
      members.filter((m) => m.id !== viewerId),
      mentionQuery.term,
    );
  }, [mentionQuery, members, viewerId]);

  // Back to the top whenever the candidate list changes, so Enter always takes
  // the best match rather than whatever position a previous search left behind.
  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery?.term, mentionQuery?.start]);

  /**
   * Inserts a mention and puts the caret back after it.
   *
   * The caret has to be restored explicitly and in a layout effect's timing —
   * React re-renders the textarea with the new value and the browser would
   * otherwise drop the cursor at the end, which is wrong for anybody mentioning
   * somebody mid-sentence.
   */
  const pickMention = useCallback(
    (member: { id: string; displayName: string }) => {
      if (!mentionQuery) return;
      const next = insertMention(draft, draftMentions, mentionQuery, member);
      setDraft(next.text);
      setDraftMentions(next.mentions);
      setCaret(next.caret);

      requestAnimationFrame(() => {
        const el = composer.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    },
    [draft, draftMentions, mentionQuery],
  );

  /** Reads the caret out of the textarea. Called from every event that can move
   *  it — typing, clicking, and arrowing around. */
  const syncCaret = useCallback(() => {
    const el = composer.current;
    if (el) setCaret(el.selectionStart ?? 0);
  }, []);

  const personCard = personCardId ? members.find((m) => m.id === personCardId) : undefined;

  // The draft is already the plain form — "@Name", no uuid — so it is measured
  // directly. The server measures the stored body through `plainText`, which
  // produces exactly this, so the two agree.
  const draftLength = messageLength(draft);
  const overLimit = draftLength > MESSAGE_MAX_LENGTH;
  const showCounter = draftLength >= MESSAGE_COUNTER_THRESHOLD;

  // The newest message the viewer sent — the only one that carries a receipt.
  const lastMineId = confirmed.reduce(
    (best, m) => (m.senderId === viewerId && m.id > best ? m.id : best),
    0,
  );

  /**
   * Each member's avatar placed on the newest message they have read.
   *
   * Recomputed only when the thread or somebody's watermark moves — it walks every
   * member over the loaded page, which is cheap but not free, and `read.changed`
   * events arrive often in an active group.
   */
  const receipts = useMemo(
    () => readReceipts(confirmed, readUpTo, viewerId),
    [confirmed, readUpTo, viewerId],
  );

  const newestId = confirmed.length ? confirmed[confirmed.length - 1]!.id : 0;
  const oldestId = confirmed.length ? confirmed[0]!.id : 0;

  const memberName = useCallback(
    (id: string | null) => members.find((m) => m.id === id)?.displayName ?? "Former member",
    [members],
  );

  const memberFace = useCallback(
    (id: string | null) => members.find((m) => m.id === id)?.avatarUrl ?? null,
    [members],
  );

  // The server's copy can only add. Never replaces, so nothing on screen
  // disappears because a refresh happened to race a send.
  useEffect(() => {
    setConfirmed((prev) => mergeMessages(prev, initialMessages));
    // A refresh can land before this tab's own POST resolves, in which case the
    // real row arrives here and the optimistic bubble must go with it — or the
    // message would briefly show twice.
    setPending((prev) => dropConfirmedPending(prev, initialMessages));
  }, [initialMessages]);

  // ---------- scrolling ----------

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [conversationId, scrollToBottom]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < STICK_THRESHOLD_PX;
    if (atBottom.current) setMissed(0);
    // Only on a real change: this runs on every scroll frame, and setting state to
    // the value it already holds would re-render the whole thread throughout a
    // smooth scroll.
    setAtBottomView((prev) => (prev === atBottom.current ? prev : atBottom.current));
  }, []);

  /**
   * Follow new messages only if the reader was already at the bottom. Yanking
   * someone back down while they are reading history is worse than a subtle
   * "N new" affordance.
   */
  useEffect(() => {
    if (atBottom.current) scrollToBottom(true);
  }, [confirmed.length, pending.length, scrollToBottom]);

  // ---------- read watermark ----------

  /**
   * Forget what was reported when the conversation changes.
   *
   * `readReported` is a high-water mark of message ids, and **ids are global** —
   * one bigserial across every conversation. Switching from a busy thread
   * (newest id 5000) to a quiet one (newest id 300) therefore left the mark above
   * anything the new thread contains, so `newestId <= readReported.current` was
   * true forever and it was **never marked read**. The badge simply stayed.
   *
   * A layout effect, so the reset lands before the effect below runs for the new
   * conversation rather than one render later.
   */
  useLayoutEffect(() => {
    readReported.current = 0;
  }, [conversationId]);

  useEffect(() => {
    if (!newestId || newestId <= readReported.current) return;
    // The STATE, not the ref — settling back at the bottom after a scroll has to
    // re-run this, or the read is never reported. See atBottomView.
    if (!atBottomView) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

    const timer = setTimeout(() => {
      readReported.current = newestId;
      // Locally first, so the badge drops the moment the thread is read rather
      // than waiting for the round trip to come back.
      clearUnread(conversationId);
      void fetch(`/api/chat/conversations/${conversationId}/read`, {
        method: "POST",
        headers: { ...realtimeHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ lastReadMessageId: newestId }),
      })
        .then((res) => {
          // The watermark is now persisted, so ask the server for the numbers
          // again. Without this the conversation list and the nav badge keep
          // whatever they were last rendered with — which, if a refresh happened
          // to land between the message arriving and this read, is a count that
          // has already been read.
          if (res.ok) router.refresh();
        })
        .catch(() => {
          // Reset so a later attempt retries rather than believing it reported.
          readReported.current = 0;
        });
    }, 600);

    return () => clearTimeout(timer);
  }, [conversationId, newestId, atBottomView, clearUnread, router]);

  // ---------- live events ----------

  useEffect(() => {
    const pusher = getPusher();
    if (!pusher) return;

    const channel = pusher.subscribe(conversationChannel(conversationId));

    const onMessage = (msg: MessageRow) => {
      setConfirmed((prev) => mergeMessages(prev, [msg]));
      // Somebody else typed it, so their typing indicator is now stale.
      setTyping((prev) => {
        if (!msg.senderId || !(msg.senderId in prev)) return prev;
        const next = { ...prev };
        delete next[msg.senderId];
        return next;
      });
      if (!atBottom.current) setMissed((n) => n + 1);
    };

    const onTyping = ({ userId }: { userId: string }) => {
      if (userId === viewerId) return;
      setTyping((prev) => ({ ...prev, [userId]: Date.now() }));
    };

    const onRead = ({ userId, lastReadMessageId }: { userId: string; lastReadMessageId: number }) => {
      // Monotonic, matching the server's GREATEST: an out-of-order event from a
      // second tab must not walk somebody's read position backwards.
      setReadUpTo((prev) =>
        (prev[userId] ?? 0) >= lastReadMessageId ? prev : { ...prev, [userId]: lastReadMessageId },
      );
    };

    /**
     * A reaction landed.
     *
     * Applied through `mergeReactionGroup`, which takes the emoji's COMPLETE
     * membership rather than a delta — so this is safe to receive twice, and safe
     * to receive after this tab has already painted its own optimistic pill. The
     * server does not exclude the acting socket from this event for exactly that
     * reason: reconciling against server truth is the point.
     */
    const onReaction = (data: ConversationEvents["reaction.changed"]) => {
      setConfirmed((prev) =>
        prev.map((m) =>
          m.id === data.messageId
            ? {
                ...m,
                reactions: mergeReactionGroup(m.reactions, {
                  emoji: data.emoji,
                  users: data.users,
                }),
              }
            : m,
        ),
      );
    };

    /**
     * A message was deleted.
     *
     * Patched in place rather than dropped from the list: the bubble becomes
     * "Message deleted" and keeps its slot, which is what the server does too —
     * removing the row would put a hole in the pagination cursor and quietly change
     * what the read watermark refers to. Its reactions and files go with it, and so
     * does every quote of it in a reply — see `applyMessageDeletion`, which is the
     * only place that fold lives so this path and the acting tab's cannot disagree.
     */
    const onDeleted = (data: ConversationEvents["message.deleted"]) => {
      setConfirmed((prev) => applyMessageDeletion(prev, data.id, new Date().toISOString()));
    };

    /** The group was renamed, or its photo changed. */
    const onUpdated = (data: ConversationEvents["conversation.updated"]) => {
      setDetail((prev) => ({
        ...prev,
        title: data.title ?? prev.title,
        // A null version means "unchanged", not "there is no photo" — see the
        // event's definition. Only an actual avatar change sends one.
        avatarUrl: data.avatarVersion
          ? `/api/chat/conversations/${prev.id}/avatar?v=${encodeURIComponent(data.avatarVersion)}`
          : prev.avatarUrl,
      }));
      // The conversation list is server-rendered, so its copy of the title comes
      // from here.
      router.refresh();
    };

    /**
     * Somebody joined, left, or changed tier.
     *
     * A signal, so this refetches rather than patching — the member list feeds the
     * UI's own permission decisions, and a pushed copy of it is a copy that can be
     * stale at the moment somebody clicks "Remove".
     */
    const onMembers = () => {
      setMembersVersion((n) => n + 1);
      void (async () => {
        const res = await fetch(`/api/chat/conversations/${conversationId}`).catch(() => null);
        const data = (await res?.json().catch(() => ({}))) as {
          conversation?: ConversationSummary;
        };
        if (data.conversation) setDetail(data.conversation);
      })();
      router.refresh();
    };

    channel.bind("message.new", onMessage);
    channel.bind("message.edited", onMessage);
    channel.bind("message.deleted", onDeleted);
    channel.bind("reaction.changed", onReaction);
    channel.bind("conversation.updated", onUpdated);
    channel.bind("members.changed", onMembers);
    channel.bind("typing.start", onTyping);
    channel.bind("read.changed", onRead);

    return () => {
      channel.unbind("message.new", onMessage);
      channel.unbind("message.edited", onMessage);
      channel.unbind("message.deleted", onDeleted);
      channel.unbind("reaction.changed", onReaction);
      channel.unbind("conversation.updated", onUpdated);
      channel.unbind("members.changed", onMembers);
      channel.unbind("typing.start", onTyping);
      channel.unbind("read.changed", onRead);
      pusher.unsubscribe(conversationChannel(conversationId));
    };
  }, [conversationId, viewerId, router]);

  /**
   * Removed from the group, or left it from another tab.
   *
   * Has to come from the per-user channel: by the time this is published the
   * membership row is gone, so /api/pusher/auth would refuse a fresh subscription
   * to the conversation channel and any event there is already unreachable.
   *
   * Bound but never unsubscribed — PusherProvider owns this channel's lifetime and
   * also listens on it for `session.revoked`, which unsubscribing here would take
   * with it. Same arrangement as UnreadProvider.
   */
  useEffect(() => {
    const pusher = getPusher();
    if (!pusher) return;

    const channel = pusher.subscribe(userChannel(viewerId));

    const onRemoved = ({ conversationId: gone }: { conversationId: string }) => {
      if (gone !== conversationId) return;
      // Out of a thread that is no longer readable, rather than leaving somebody
      // looking at a conversation whose next request will 404.
      router.refresh();
      router.push("/chat");
    };

    channel.bind("conversation.removed", onRemoved);
    return () => {
      channel.unbind("conversation.removed", onRemoved);
    };
  }, [conversationId, viewerId, router]);

  /**
   * Catch-up. PUSHER DOES NOT REPLAY, so anything published while this tab was
   * disconnected is gone unless it is asked for. Because ids are a monotonic
   * bigserial, `after=<newest rendered>` is exact — no timestamp comparison and
   * no overlap window to de-duplicate.
   */
  useEffect(() => {
    if (connectionState !== "connected") return;
    if (!hasConnected.current) {
      // First connect needs nothing: the server just rendered this thread.
      hasConnected.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/chat/conversations/${conversationId}/messages?after=${newestId}`,
      ).catch(() => null);
      const data = (await res?.json().catch(() => ({}))) as { messages?: MessageRow[] };
      if (!cancelled && data.messages?.length) {
        setConfirmed((prev) => mergeMessages(prev, data.messages!));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionState, conversationId, newestId]);

  // Expire typing indicators — there is no `typing.stop` by design.
  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const timer = setInterval(() => {
      const cutoff = Date.now() - TYPING_EXPIRY_MS;
      setTyping((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, at]) => at > cutoff));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [typing]);

  // ---------- sending ----------

  const pingTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingPing.current < TYPING_PING_MS) return;
    lastTypingPing.current = now;

    void fetch("/api/chat/typing", {
      method: "POST",
      headers: { ...realtimeHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    }).catch(() => {});
  }, [conversationId]);

  const send = useCallback(
    async (
      bodyText: string,
      options?: {
        existingClientMsgId?: string;
        attachments?: AttachmentView[];
        replyTo?: ReplyPreview | null;
      },
    ) => {
      const body = bodyText.trim();
      const attachments = options?.attachments ?? [];
      const replyTo = options?.replyTo ?? null;
      const existingClientMsgId = options?.existingClientMsgId;

      // A body OR files. An attachment-only message is a real message — somebody
      // drops a screenshot in with nothing to add — so emptiness only blocks a
      // send when there is nothing else either.
      if (!body && !attachments.length) return;

      // Generated here and reused on retry, so a resend cannot double-post: the
      // unique index on (conversation_id, client_msg_id) turns it into a no-op.
      // That covers the attachments too — a retry re-sends the same ids, and the
      // server reads back what the first attempt already claimed rather than
      // trying to claim them twice.
      const clientMsgId = existingClientMsgId ?? crypto.randomUUID();

      setPending((prev) =>
        existingClientMsgId
          ? prev.map((p) => (p.clientMsgId === clientMsgId ? { ...p, failed: false } : p))
          : [...prev, { clientMsgId, body, failed: false, attachments, replyTo }],
      );
      setSending(true);
      // Sending puts you back at the bottom: you are looking at your own message.
      atBottom.current = true;
      setAtBottomView(true);

      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { ...realtimeHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          clientMsgId,
          body,
          replyToId: replyTo?.id ?? null,
          // Ids only. The server re-checks that each was staged by this person
          // for this conversation and is not already sent — see claimAttachments.
          attachmentIds: attachments.map((a) => a.id),
        }),
      }).catch(() => null);

      const data = (await res?.json().catch(() => ({}))) as { ok?: boolean; message?: MessageRow };
      setSending(false);

      if (!res?.ok || !data.ok || !data.message) {
        setPending((prev) =>
          prev.map((p) => (p.clientMsgId === clientMsgId ? { ...p, failed: true } : p)),
        );
        return;
      }

      // This tab was excluded from the fan-out, so the response is where the
      // real row comes from.
      setConfirmed((prev) => mergeMessages(prev, [data.message!]));

      // ── And the same exclusion is why the list has to be told here ──
      //
      // Every other member's conversation list reorders on `unread.changed`. This
      // tab never receives that event — Pusher drops it for the acting socket, on
      // purpose — so without this the conversation rises to the top for everybody
      // except the person who just wrote in it.
      //
      // The server's own timestamp, not a local guess, so this agrees exactly with
      // what every other member sorted on.
      bumpConversation({
        conversationId,
        preview: attachmentSummary(
          plainText(data.message.body),
          data.message.attachments,
        ).slice(0, 140),
        at: data.message.createdAt,
      });
      setPending((prev) => prev.filter((p) => p.clientMsgId !== clientMsgId));
    },
    [conversationId, bumpConversation],
  );

  // ---------- reactions ----------

  /**
   * Toggles the viewer's reaction on a message.
   *
   * Optimistic, and deliberately not rolled back on failure. The event that
   * follows carries the emoji's complete membership, so a failed request is
   * corrected by the next thing the server says about that emoji — and if nothing
   * follows, the next page load is authoritative. Rolling back manually would mean
   * guessing which of two racing taps to undo.
   */
  const toggleReaction = useCallback(
    async (messageId: number, emoji: string) => {
      const me = {
        id: viewerId,
        displayName: members.find((m) => m.id === viewerId)?.displayName ?? "You",
      };

      setConfirmed((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, reactions: applyReactionToggle(m.reactions, emoji, me) }
            : m,
        ),
      );

      const res = await fetch(
        `/api/chat/conversations/${conversationId}/messages/${messageId}/reactions`,
        {
          method: "POST",
          headers: { ...realtimeHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        },
      ).catch(() => null);

      const data = (await res?.json().catch(() => ({}))) as {
        ok?: boolean;
        reaction?: ReactionGroup;
      };

      // The response is server truth for this emoji, same shape as the event.
      // Applied whether or not the event also arrives, because this tab is not
      // excluded from the fan-out and merging is idempotent either way.
      if (res?.ok && data.ok && data.reaction) {
        setConfirmed((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, reactions: mergeReactionGroup(m.reactions, data.reaction!) }
              : m,
          ),
        );
      }
    },
    [conversationId, members, viewerId],
  );

  /** Deletes one of your own messages. The bubble keeps its slot and becomes
   *  "Message deleted"; its reactions go, on the server and here. */
  const removeMessage = useCallback(
    async (messageId: number) => {
      const res = await fetch(
        `/api/chat/conversations/${conversationId}/messages/${messageId}`,
        { method: "DELETE", headers: realtimeHeaders() },
      ).catch(() => null);

      if (!res?.ok) return;

      // The same fold the event applies for everybody else, so the person who
      // deleted it sees exactly what they see — including the replies quoting it
      // going quiet.
      setConfirmed((prev) => applyMessageDeletion(prev, messageId, new Date().toISOString()));
    },
    [conversationId],
  );

  /** Clears the composer first, so a slow send does not leave the text sitting
   *  there looking unsent while the optimistic bubble is already below it. */
  const submitDraft = useCallback(() => {
    // The plain draft becomes the stored form HERE, at the last moment — the
    // composer never held a uuid, and this is the only place one is introduced.
    const body = serializeMentions(draft, draftMentions);
    const ready = uploads.files.flatMap((f) => (f.attachment ? [f.attachment] : []));

    // Both checks are on the DRAFT, not on `body`: the serialized form carries
    // uuids the sender never typed, so measuring it would reject a message that
    // looks well under the limit.
    if (!draft.trim() && !ready.length) return;
    // Checked here and not only on the button: Enter-to-send does not care whether
    // a button is disabled.
    if (messageLength(draft) > MESSAGE_MAX_LENGTH) return;
    // Held back while anything is still going up, so a message never goes with
    // half its files attached. The Send button is disabled for the same reason;
    // this is the Enter key's copy of the rule.
    if (uploads.busy) return;

    const replyTo = replyingTo;

    // The composer is emptied first — text, quote and tray — so a slow send does
    // not leave all three sitting there looking unsent while the optimistic
    // bubble is already below them.
    setDraft("");
    setDraftMentions([]);
    setReplyingTo(null);
    // Clears the tray WITHOUT deleting anything server-side: those rows belong to
    // the message now, and `clear` is deliberately not `remove`.
    uploads.clear();

    void send(body, { attachments: ready, replyTo });
  }, [draft, draftMentions, send, uploads, replyingTo]);

  // ---------- older pages ----------

  /**
   * Fetches the page before the oldest message on screen.
   *
   * A `useCallback` returning whether it actually added anything, because the
   * jump-to-quoted-message loop drives it: it has to be able to page backwards
   * repeatedly and to know when it has hit the beginning of the conversation
   * rather than looping forever.
   *
   * `preserveScroll` is off for those automated pages — the loop is deliberately
   * moving the viewport, so pinning it in place would fight the thing it is
   * trying to do.
   */
  const loadOlder = useCallback(
    async (opts?: { preserveScroll?: boolean }): Promise<boolean> => {
      const preserveScroll = opts?.preserveScroll ?? true;
      const cursor = confirmed.length ? confirmed[0]!.id : 0;
      if (!cursor) return false;

      setLoadingOlder(true);

      const el = scroller.current;
      const heightBefore = el?.scrollHeight ?? 0;

      const res = await fetch(
        `/api/chat/conversations/${conversationId}/messages?before=${cursor}`,
      ).catch(() => null);
      const data = (await res?.json().catch(() => ({}))) as {
        messages?: MessageRow[];
        hasMore?: boolean;
      };

      setLoadingOlder(false);

      if (!data.messages?.length) {
        setHasMore(false);
        return false;
      }

      setConfirmed((prev) => mergeMessages(prev, data.messages!));
      setHasMore(!!data.hasMore);

      if (preserveScroll) {
        // Keep the reader where they were rather than letting prepended content
        // shove the viewport down.
        requestAnimationFrame(() => {
          const after = scroller.current;
          if (after) after.scrollTop = after.scrollHeight - heightBefore;
        });
      }
      return true;
    },
    [confirmed, conversationId],
  );

  // ---------- jumping to a quoted message ----------

  /**
   * Starts the hunt for a message. Called by the quote inside a reply bubble.
   *
   * It cannot simply scroll: the message being answered may be hundreds of
   * messages back and not loaded at all. So this only sets the target, and the
   * effect below does the paging — which keeps the whole loop inside React's
   * render cycle instead of poking at the DOM between fetches and hoping it has
   * caught up.
   */
  const jumpToMessage = useCallback((messageId: number) => {
    setJumpFailed(false);
    setJumpTarget(messageId);
  }, []);

  useEffect(() => {
    if (jumpTarget === null) return;

    const loaded = confirmed.some((m) => m.id === jumpTarget);

    if (loaded) {
      // In the list, so it is in the DOM after this commit.
      const el = document.getElementById(`msg-${jumpTarget}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Scrolling away from the bottom means incoming messages should stop
        // yanking the viewport down; the "N new" affordance takes over.
        atBottom.current = false;
        setAtBottomView(false);
        setHighlightId(jumpTarget);
      }
      setJumpTarget(null);
      return;
    }

    // Not loaded, and there is nothing older to load — the parent has been paged
    // past the beginning, which in practice means it was hard-deleted.
    if (!hasMore) {
      setJumpTarget(null);
      setJumpFailed(true);
      return;
    }

    if (loadingOlder) return;
    void loadOlder({ preserveScroll: false });
  }, [jumpTarget, confirmed, hasMore, loadingOlder, loadOlder]);

  /** The flash fades on its own. Long enough to catch the eye, short enough not to
   *  leave a permanently-marked message behind. */
  useEffect(() => {
    if (highlightId === null) return;
    const timer = setTimeout(() => setHighlightId(null), 1800);
    return () => clearTimeout(timer);
  }, [highlightId]);

  useEffect(() => {
    if (!jumpFailed) return;
    const timer = setTimeout(() => setJumpFailed(false), 4000);
    return () => clearTimeout(timer);
  }, [jumpFailed]);

  // ---------- render ----------

  const typingNames = useMemo(
    () => Object.keys(typing).map(memberName),
    [typing, memberName],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-line">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <Avatar
          person={{
            id: conversationId,
            name: title,
            // A group's own photo; a DM's is the other person's face. Initials of
            // the group name when it has none, which reads as a group rather than
            // as a person.
            avatarUrl: isGroup ? detail.avatarUrl : (dmPartner?.avatarUrl ?? null),
          }}
          size="h-9 w-9"
          online={tracking && dmPartner ? online.has(dmPartner.id) : undefined}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{title}</p>
          <p className="truncate text-[11px] text-faint">
            {isGroup ? (
              // Names rather than a bare count: in a group of five, who is in it
              // is the thing you actually want to know at a glance.
              members.map((m) => (m.id === viewerId ? "You" : m.displayName)).join(", ")
            ) : dmPartner && tracking ? (
              online.has(dmPartner.id) ? "Online" : "Offline"
            ) : (
              `${members.length} member${members.length === 1 ? "" : "s"}`
            )}
          </p>
        </div>

        {isGroup ? (
          <Button size="sm" variant="quiet" className="shrink-0" onClick={() => setManaging(true)}>
            {/* Everyone gets the button, not only admins: a plain member still
                needs to see who is in the group and to be able to leave it. The
                dialog hides the controls they cannot use, and the server refuses
                them regardless. */}
            Group
          </Button>
        ) : null}
      </div>

      {managing && isGroup ? (
        <GroupDialog
          conversation={detail}
          viewerId={viewerId}
          refreshKey={membersVersion}
          onClose={() => setManaging(false)}
        />
      ) : null}

      <div
        ref={scroller}
        onScroll={onScroll}
        className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {hasMore ? (
          <div className="pb-4 text-center">
            <Button size="sm" variant="quiet" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? "Loading…" : "Load older messages"}
            </Button>
          </div>
        ) : null}

        {!confirmed.length && !pending.length ? (
          <p className="py-12 text-center text-xs text-faint">
            No messages yet. Say something.
          </p>
        ) : null}

        <div className="space-y-2.5">
          {confirmed.map((m) =>
            // A membership or rename event, not somebody's words. Centred, no
            // bubble, no avatar, no reactions — it is the group narrating itself,
            // and dressing it as a message would invite replying to it.
            m.kind === "system" ? (
              <SystemLine key={m.id} body={m.body} at={m.createdAt} />
            ) : (
              <Bubble
                key={m.id}
                // Messenger-style: each person's face sits on the last message
                // THEY read, wherever that is in the thread — not a tick under
                // your own newest one. See lib/chat/receipts.ts.
                seenBy={(receipts.get(m.id) ?? []).flatMap((id) => {
                  const member = members.find((x) => x.id === id);
                  return member ? [member] : [];
                })}
                // The single tick still means something the faces cannot: your
                // newest message has been sent and nobody has caught up to it yet.
                showSent={m.senderId === viewerId && m.id === lastMineId && !receipts.has(m.id)}
                mine={m.senderId === viewerId}
                author={memberName(m.senderId)}
                authorId={m.senderId}
                authorFace={memberFace(m.senderId)}
                body={m.body}
                at={m.createdAt}
                deleted={!!m.deletedAt}
                reactions={m.reactions}
                viewerId={viewerId}
                onReact={(emoji) => void toggleReaction(m.id, emoji)}
                mentionMembers={members}
                onOpenPerson={setPersonCardId}
                messageId={m.id}
                highlighted={highlightId === m.id}
                attachments={m.attachments}
                replyTo={m.replyTo}
                onJump={jumpToMessage}
                onOpenImage={setLightbox}
                onReply={() =>
                  // The quote comes from the server's own view of the message,
                  // built by the same helper that will render it inside the sent
                  // bubble — so what you see while typing is what everybody sees
                  // afterwards.
                  setReplyingTo({
                    id: m.id,
                    senderId: m.senderId,
                    senderName: m.senderName,
                    preview:
                      m.body.trim() ||
                      (m.attachments.length
                        ? m.attachments.length === 1
                          ? m.attachments[0]!.filename
                          : `${m.attachments.length} files`
                        : ""),
                    deleted: !!m.deletedAt,
                    thumbnailAttachmentId:
                      m.attachments.find((a) => a.mime.startsWith("image/"))?.id ?? null,
                    attachmentCount: m.attachments.length,
                  })
                }
                onDelete={
                  // Your own, and not already gone. There is no admin override:
                  // somebody who could silently remove other people's words is a
                  // different product with different promises.
                  m.senderId === viewerId && !m.deletedAt
                    ? () => void removeMessage(m.id)
                    : undefined
                }
              />
            ),
          )}

          {pending.map((p) => (
            <Bubble
              key={p.clientMsgId}
              mine
              author=""
              body={p.body}
              at={null}
              state={p.failed ? "failed" : "sending"}
              viewerId={viewerId}
              // The optimistic bubble shows its files and its quote, so it is the
              // same height and shape as the real row that replaces it. No
              // onReact: there is no server-side message id to hang a reaction on
              // until the POST comes back.
              attachments={p.attachments}
              replyTo={p.replyTo}
              mentionMembers={members}
              onOpenPerson={setPersonCardId}
              onJump={jumpToMessage}
              onOpenImage={setLightbox}
              onRetry={
                p.failed
                  ? () =>
                      void send(p.body, {
                        existingClientMsgId: p.clientMsgId,
                        attachments: p.attachments,
                        replyTo: p.replyTo,
                      })
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      {/* The quoted message could not be found even after paging back to the
          beginning — in practice it was hard-deleted. Said out loud, because a
          tap that silently does nothing reads as a broken button. */}
      {jumpFailed ? (
        <p
          className="mx-auto -mt-2 mb-1 rounded-full bg-subtle-2 px-3 py-1.5 text-[11px] font-semibold text-faint"
          aria-live="polite"
        >
          That message isn&apos;t in this conversation any more.
        </p>
      ) : null}

      {/* ── Jump to the latest message ──
          One control with two faces. Back-reading a long thread and then wanting
          the bottom again used to mean scrolling all the way by hand — the pill
          only existed while unread messages had arrived, which is not the same
          thing as being scrolled up.
          So it shows whenever you are away from the bottom, and says how many you
          have missed only when that is actually true. */}
      {!atBottomView ? (
        <button
          type="button"
          onClick={() => {
            setMissed(0);
            atBottom.current = true;
            setAtBottomView(true);
            scrollToBottom(true);
          }}
          title={missed > 0 ? `${missed} new — jump to the latest` : "Jump to the latest message"}
          aria-label={missed > 0 ? `${missed} new messages, jump to the latest` : "Jump to the latest message"}
          className={`mx-auto -mt-2 mb-1 flex items-center gap-1.5 rounded-full shadow-lg transition ${
            missed > 0
              ? "bg-accent px-3 py-1.5 text-[11px] font-semibold text-on-accent"
              : // No unread: a quiet circle rather than a labelled pill, so it does
                // not read as a notification when there is nothing to notify.
                "bg-surface p-1.5 text-muted ring-1 ring-line-2 hover:text-brand-fg hover:ring-brand-soft"
          }`}
        >
          {missed > 0 ? `${missed} new message${missed === 1 ? "" : "s"}` : null}
          <Icon name="chevron" className="h-3 w-3 rotate-90" />
        </button>
      ) : null}

      <div className="h-5 shrink-0 px-4">
        {typingNames.length ? (
          <p className="truncate text-[11px] italic text-faint">
            {typingNames.length === 1
              ? `${typingNames[0]} is typing…`
              : `${typingNames.length} people are typing…`}
          </p>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitDraft();
        }}
        className="shrink-0 border-t border-line"
      >
        {/* Quote first, then files, then the input — reading order matches the
            order they were added in, and both sit above the text rather than
            beside it so a long filename cannot squeeze the composer. */}
        {replyingTo ? (
          <ReplyComposerChip reply={replyingTo} onCancel={() => setReplyingTo(null)} />
        ) : null}

        <ComposerAttachments
          files={uploads.files}
          onRemove={uploads.remove}
          onRetry={uploads.retry}
        />

        {uploads.error ? (
          <p className="px-3 pt-2 text-[11px] font-semibold text-bad" aria-live="polite">
            {uploads.error}
          </p>
        ) : null}

        <div className="relative flex items-end gap-1 p-3">
          {/* Anchored to the composer row and opening upward — the composer sits
              at the bottom of the viewport, so a list below it would be
              off-screen. On a narrow layout it is width-capped to the viewport,
              which is what keeps it usable on a phone. */}
          {mentionQuery && mentionCandidates.length ? (
            <MentionPicker
              candidates={mentionCandidates}
              activeIndex={mentionIndex}
              onPick={pickMention}
              onHoverIndex={setMentionIndex}
            />
          ) : null}

          <AttachButton
            accept={ACCEPT_ATTRIBUTE}
            onPick={uploads.pick}
            disabled={uploads.files.length >= ATTACHMENT_MAX_PER_MESSAGE}
          />
          <div className="min-w-0 flex-1">
          {showCounter ? (
            <p
              className={`mb-1 text-right text-[10px] font-semibold ${
                overLimit ? "text-bad" : "text-faint"
              }`}
              // Announced only once it matters, so a screen reader is not told
              // the count on every keystroke of a short message.
              aria-live="polite"
            >
              {overLimit
                ? `${draftLength - MESSAGE_MAX_LENGTH} over the ${MESSAGE_MAX_LENGTH} limit`
                : `${draftLength} / ${MESSAGE_MAX_LENGTH}`}
            </p>
          ) : null}
        <textarea
          ref={composer}
          value={draft}
          rows={1}
          // The combobox pairing: focus never leaves this textarea while the
          // mention list is open, so `aria-activedescendant` is how a screen
          // reader is told the highlighted option moved.
          role={mentionQuery && mentionCandidates.length ? "combobox" : undefined}
          aria-expanded={mentionQuery && mentionCandidates.length ? true : undefined}
          aria-controls={mentionQuery && mentionCandidates.length ? "mention-listbox" : undefined}
          aria-activedescendant={
            mentionQuery && mentionCandidates.length ? `mention-option-${mentionIndex}` : undefined
          }
          aria-autocomplete={mentionQuery && mentionCandidates.length ? "list" : undefined}
          onSelect={syncCaret}
          onClick={syncCaret}
          placeholder={uploads.files.length ? "Add a message, or just send the files…" : "Write a message…"}
          aria-invalid={overLimit}
          onChange={(e) => {
            // The ranges move with the text: shifted when the edit is before them,
            // dropped when it is inside one. Somebody backspacing into a name no
            // longer means that mention.
            setDraftMentions((prev) => adjustMentions(prev, draft, e.target.value));
            setDraft(e.target.value);
            // After the value, so `mentionQueryAt` measures against what was just
            // typed rather than the previous render's caret.
            setCaret(e.target.selectionStart ?? e.target.value.length);
            if (e.target.value.trim()) pingTyping();
          }}
          onKeyDown={(e) => {
            // ── While the mention list is open it owns these keys ──
            //
            // Checked BEFORE the Enter-to-send rule, or picking a name from the
            // list would send the half-typed message instead. Every one of these
            // preventDefaults matters: Arrow keys would otherwise move the caret
            // and Enter would insert a newline.
            const picking = mentionQuery && mentionCandidates.length > 0;
            if (picking) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => (i + 1) % mentionCandidates.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex(
                  (i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length,
                );
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(mentionCandidates[mentionIndex] ?? mentionCandidates[0]!);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                // Closed by moving the caret out of the query rather than by a
                // separate "dismissed" flag — one source of truth for whether the
                // list is open, and typing another character legitimately reopens
                // it.
                setCaret(-1);
                return;
              }
            }

            // Enter sends; Shift+Enter is a newline. The usual contract, and the
            // one people will assume without being told.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitDraft();
            }
          }}
          onKeyUp={syncCaret}
          className={`max-h-32 min-h-[42px] w-full resize-y rounded-xl bg-subtle px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-faintest focus:bg-surface focus:outline-none focus:ring-2 ${
            overLimit ? "ring-2 ring-bad focus:ring-bad" : "focus:ring-brand-soft"
          }`}
        />
          </div>
          <Button
            type="submit"
            variant="dark"
            // `!draft.trim() && !hasReadyFiles` and not `!draft.trim()`: a message
            // with only files is sendable. Held while anything is still uploading,
            // so nothing goes with half its attachments.
            disabled={
              sending || uploads.busy || (!draft.trim() && !uploads.readyIds.length) || overLimit
            }
            title={
              overLimit
                ? `Too long by ${draftLength - MESSAGE_MAX_LENGTH} characters`
                : uploads.busy
                  ? "Waiting for the upload to finish"
                  : undefined
            }
            className="shrink-0"
          >
            Send
          </Button>
        </div>
      </form>

      {lightbox ? (
        <ImageLightbox attachment={lightbox} onClose={() => setLightbox(null)} />
      ) : null}

      {personCard ? (
        <PersonCard
          member={personCard}
          online={online.has(personCard.id)}
          tracking={tracking}
          isViewer={personCard.id === viewerId}
          onClose={() => setPersonCardId(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One message.
 *
 * `body` is a text child, so React escapes it. There is no
 * dangerouslySetInnerHTML here and there must not be: chat is the first place in
 * this app where one person's typing is rendered to another, and it is the whole
 * XSS surface. If link or markdown rendering is ever wanted, that is a sanitiser
 * decision, not a reason to hand raw HTML to the DOM.
 */
function Bubble({
  mine,
  author,
  authorId,
  authorFace,
  body,
  at,
  state,
  deleted,
  seenBy,
  showSent,
  reactions,
  viewerId,
  mentionMembers,
  onOpenPerson,
  messageId,
  highlighted,
  attachments,
  replyTo,
  onJump,
  onOpenImage,
  onReply,
  onReact,
  onDelete,
  onRetry,
}: {
  mine: boolean;
  author: string;
  authorId?: string | null;
  authorFace?: string | null;
  body: string;
  at: string | null;
  state?: "sending" | "failed";
  deleted?: boolean;
  /** Members whose read watermark lands on THIS message — their face goes here.
   *  Usually empty; a message is only somebody's high-water mark once. */
  seenBy?: { id: string; displayName: string; avatarUrl: string | null }[];
  /** Your newest message, which nobody has caught up to yet. The one thing a row
   *  of faces cannot say, because there are no faces to show. */
  showSent?: boolean;
  reactions?: ReactionGroup[];
  viewerId?: string;
  /** The conversation's members, so a mention resolves to today's display name
   *  rather than the one baked into the token when it was written. */
  mentionMembers?: readonly { id: string; displayName: string }[];
  onOpenPerson?: (userId: string) => void;
  /** Absent on an optimistic bubble — there is no server id yet. It is what the
   *  scroll target is keyed on, so a quote can find this bubble in the DOM. */
  messageId?: number;
  /** Briefly ringed, because something jumped here. */
  highlighted?: boolean;
  attachments?: AttachmentView[];
  replyTo?: ReplyPreview | null;
  onJump?: (messageId: number) => void;
  onOpenImage?: (attachment: AttachmentView) => void;
  /** Absent on an optimistic bubble and on a deleted one: you cannot answer
   *  something that has not landed or has been withdrawn. */
  onReply?: () => void;
  /** Absent on an optimistic bubble: there is no server-side id to hang a
   *  reaction on until the POST comes back. */
  onReact?: (emoji: string) => void;
  /** Absent unless this is the viewer's own, undeleted message. */
  onDelete?: () => void;
  onRetry?: () => void;
}) {
  const files = attachments ?? [];
  return (
    /**
     * ── The layout, and the two things it got wrong before ──
     *
     * 1. THE AVATAR MUST SHARE A ROW WITH THE BUBBLE, not with the whole column.
     *    It used to be a sibling of a `flex-col` holding [name, bubble, pills,
     *    timestamp] under `items-end`, which bottom-aligns it against the LAST of
     *    those. Adding the reactions row therefore pushed the face down below the
     *    bubble it belongs to — visible in the screenshot as a head floating
     *    beside the timestamp. So the avatar now lives inside the bubble's own
     *    row, and everything that stacks underneath is indented past it with
     *    `pl-9` (h-7 avatar = 28px, plus gap-2 = 36px = 2.25rem) to keep the
     *    left edges lined up.
     *
     * 2. THE ⊕ IS AN ACTION, so it belongs beside the bubble and only while the
     *    message is hovered — not parked under every message forever. `group` on
     *    this wrapper is what the reveal hangs off.
     *
     * `flex-col` is load-bearing, not decoration: without it the `items-*` classes
     * are inert, the bubble stretches to full width, and a three-letter message
     * renders in a bubble sized to its timestamp row.
     */
    <div
      // The scroll target for a reply quote. Keyed on the message id so
      // `jumpToMessage` can find it with getElementById after the page that
      // contains it has been loaded.
      id={messageId ? `msg-${messageId}` : undefined}
      // `scroll-mt` so a jumped-to bubble does not land flush against the header.
      className={`group flex scroll-mt-8 flex-col ${mine ? "items-end" : "items-start"}`}
    >
      {!mine && author ? (
        <p className="mb-0.5 pl-9 text-[10px] font-semibold text-faint">{author}</p>
      ) : null}

      {/* The row: face, words, and the controls that act on them. */}
      <div className={`flex max-w-[85%] items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
        {/* Only on the other side: your own face beside your own words is noise. */}
        {!mine && author ? (
          <Avatar
            person={{ id: authorId ?? author, name: author, avatarUrl: authorFace }}
            size="h-7 w-7"
          />
        ) : null}

        <div
          className={`min-w-0 rounded-2xl px-3.5 py-2 text-sm leading-relaxed transition-shadow ${
            deleted
              ? "bg-subtle-2 italic text-faint"
              : mine
                ? "bg-brand-500 text-white"
                : "bg-subtle text-ink-2"
          } ${state === "failed" ? "ring-1 ring-bad" : ""} ${
            state === "sending" ? "opacity-60" : ""
          } ${
            // The flash after a jump. A ring rather than a background change, so
            // it does not fight the bubble's own colour or the text on it.
            highlighted ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-surface" : ""
          }`}
        >
          {/* A deleted message is "Message deleted" and NOTHING else — no quote,
              no files, no text. It used to keep its reply quote, which left the
              text of somebody else's message sitting above the words "Message
              deleted": the one thing a soft delete is supposed to prevent, and
              worse than useless because it looks like the quote is what was
              withdrawn. Same rule as reactions and attachments, which are already
              suppressed here. */}
          {deleted ? (
            "Message deleted"
          ) : (
            <>
              {/* The quote sits INSIDE the bubble, above the text — Messenger's
                  arrangement, and the one that makes it unambiguous which message
                  the quote belongs to when several replies stack up. */}
              {replyTo && viewerId ? (
                <ReplyQuote
                  reply={replyTo}
                  viewerId={viewerId}
                  mine={mine}
                  onJump={onJump ?? (() => {})}
                />
              ) : null}

              {/* An attachment-only message has no text, and an empty <span>
                  would still take a line's height.

                  MessageText linkifies without producing any HTML — it splits the
                  body into segments and renders each as a React child, so the
                  escaping is exactly what it was when this was one text child. See
                  its header; this is the one place in the app where one person's
                  typing is rendered to another. */}
              {body ? (
                <MessageText
                  body={body}
                  mine={mine}
                  viewerId={viewerId}
                  members={mentionMembers}
                  onOpenPerson={onOpenPerson}
                />
              ) : null}
              {body ? <LinkPreviewCard body={body} mine={mine} /> : null}
              {files.length ? (
                <AttachmentGrid
                  attachments={files}
                  mine={mine}
                  onOpenImage={onOpenImage ?? (() => {})}
                />
              ) : null}
            </>
          )}
        </div>

        {/* `flex-row-reverse` above puts these on the far side of the bubble from
            the edge, so they never sit between a message and the thread's margin. */}
        {!deleted && (onDelete || onReply || (onReact && viewerId)) ? (
          <span className="flex shrink-0 items-center gap-1">
            {onReply ? (
              <HoverAction>
                <button
                  type="button"
                  onClick={onReply}
                  title="Reply to this message"
                  aria-label="Reply to this message"
                  className="grid h-6 w-6 place-items-center rounded-full text-faintest ring-1 ring-line-2 transition hover:bg-subtle hover:text-brand-fg"
                >
                  {/* A left-turning arrow: the reply glyph everybody already
                      reads, built from the chevron this app already has rather
                      than a new icon for one button. */}
                  <Icon name="chevron" className="h-3 w-3 rotate-180" />
                </button>
              </HoverAction>
            ) : null}
            {onReact && viewerId ? (
              <ReactionPicker
                reactions={reactions ?? []}
                viewerId={viewerId}
                align={mine ? "right" : "left"}
                onToggle={onReact}
              />
            ) : null}
            {onDelete ? (
              <HoverAction>
                <DeleteButton onDelete={onDelete} />
              </HoverAction>
            ) : null}
          </span>
        ) : null}
      </div>

      {/* Pills stack under the bubble, indented past the avatar. Nothing at all on
          a deleted message — the server clears the rows, and a count of laughs at
          something nobody can read is worse than nothing. */}
      {onReact && viewerId && !deleted ? (
        <div className={mine ? "" : "pl-9"}>
          <ReactionPills
            reactions={reactions ?? []}
            viewerId={viewerId}
            align={mine ? "right" : "left"}
            onToggle={onReact}
          />
        </div>
      ) : null}

      <div
        className={`mt-0.5 flex items-center gap-1.5 ${mine ? "justify-end pr-1" : "pl-9"}`}
      >
        <Status state={state} at={at} showSent={showSent} onRetry={onRetry} />
      </div>

      {/* ── The faces, on their own line and always at the right edge ──
          Right-aligned whoever sent the message, because this is a property of
          the CONVERSATION rather than of the bubble above it: a single column
          down the edge of the thread reads as a waterline, which is the whole
          point. Messenger does the same. */}
      {seenBy?.length ? (
        <div
          className="mt-0.5 flex justify-end gap-0.5 self-end"
          title={seenByLabel(seenBy.map((m) => m.displayName))}
          aria-label={seenByLabel(seenBy.map((m) => m.displayName))}
        >
          {seenBy.slice(0, 6).map((member) => (
            <Avatar
              key={member.id}
              person={{ id: member.id, name: member.displayName, avatarUrl: member.avatarUrl }}
              // Deliberately tiny. These sit under every message somebody has
              // caught up to, so at any normal avatar size they would compete
              // with the conversation.
              size="h-3.5 w-3.5"
            />
          ))}
          {seenBy.length > 6 ? (
            <span className="ml-0.5 text-[9px] font-semibold text-faintest">
              +{seenBy.length - 6}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Sent / sending / failed / read, as icons.
 *
 * ── Why icons and not words ──
 *
 * This line sits under every single message, so it is the most repeated text in
 * the app — and it was carrying "Sending…", "Failed — retry" and "Read by 2" in
 * prose. Four words of grey text under a three-word message reads as a caption on
 * the message rather than as its status, and "Failed — retry" in particular looked
 * like part of what somebody had written.
 *
 * A clock, a warning triangle and one or two ticks are the vocabulary every
 * messaging app has already taught everybody, and they collapse the row to
 * something the eye skips until it needs it. Every one keeps a `title`, so the
 * words are still there for a cursor, and the retry stays a real button with an
 * `aria-label` — an icon with no accessible name is a button nobody can identify.
 */
function Status({
  state,
  at,
  showSent,
  onRetry,
}: {
  state?: "sending" | "failed";
  at: string | null;
  /** Your newest message, not yet caught up to by anybody. */
  showSent?: boolean;
  onRetry?: () => void;
}) {
  if (state === "failed") {
    return (
      <button
        type="button"
        onClick={onRetry}
        title="Couldn't send — click to try again"
        aria-label="Couldn't send — click to try again"
        className="inline-flex items-center gap-1 text-bad transition hover:text-bad-strong"
      >
        <Icon name="alert" className="h-3 w-3" />
        <Icon name="refresh" className="h-3 w-3" />
      </button>
    );
  }

  if (state === "sending") {
    return (
      <span title="Sending…" aria-label="Sending" className="text-faintest">
        <Icon name="clock" className="h-3 w-3" />
      </span>
    );
  }

  if (!at) return null;

  return (
    <>
      <span className="text-[10px] text-faintest">{formatDateTime(at)}</span>
      {/* A single tick, and ONLY while nobody has caught up.
          "Read" is no longer a tick at all — it is the row of faces below, which
          says who as well as whether. Two ticks and a column of avatars would be
          the same fact told twice. */}
      {showSent ? (
        <span className="text-faintest" title="Sent — not read yet" aria-label="Sent, not read yet">
          <Icon name="check" className="h-3 w-3" />
        </span>
      ) : null}
    </>
  );
}

/**
 * "Alex added Jamie." A group narrating itself.
 *
 * Rendered as a centred line rather than a bubble, deliberately: it has no
 * author to reply to, no receipt, and nothing to react to. Dressing it like a
 * message would invite all three.
 *
 * `body` is baked server-side with the names as they were when it happened (see
 * lib/chat/groups.ts), so this component does no name resolution — a line that
 * rewrote itself when somebody was renamed would not be a log.
 *
 * A text child, so React escapes it. Same rule as Bubble: there is no
 * dangerouslySetInnerHTML here and there must not be, even though this string is
 * server-composed — a group NAME is user input, and it is interpolated into it.
 */
function SystemLine({ body, at }: { body: string; at: string }) {
  return (
    <div className="flex justify-center py-1">
      <p
        className="max-w-[85%] rounded-full bg-subtle-2 px-3 py-1 text-center text-[11px] text-faint"
        title={formatDateTime(at) ?? undefined}
      >
        {body}
      </p>
    </div>
  );
}

/**
 * Two clicks to delete a message, with no dialog.
 *
 * ── Why two clicks and not one, and why not a modal ──
 *
 * Deletion here is irreversible: the body is cleared server-side and the
 * reactions are removed outright. A single ✕ sitting next to every bubble, which
 * appears on hover exactly where a cursor already is, is a mis-click away from
 * losing something — so the first click only arms it.
 *
 * A modal would be the other answer and is worse for this: it steals focus from
 * the composer, covers the thread you are deleting from, and is far more ceremony
 * than one message deserves. The armed state says what will happen, stays put
 * until it is used, and disarms on a few seconds of inaction or on blur — so
 * walking away never leaves a live trigger sitting under the pointer.
 *
 * The hover reveal is not here — `HoverAction` wraps this, so the ✕ and the ⊕
 * beside it appear and disappear together instead of each owning a copy of the
 * same opacity rules.
 */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (armed) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onDelete}
          onBlur={() => setArmed(false)}
          // Autofocus so Enter confirms and Escape-then-Tab does not leave a
          // primed button behind. It is a deliberate focus move: the reader just
          // asked for this control.
          autoFocus
          className="rounded-full bg-bad-strong px-2 py-0.5 text-[10px] font-semibold text-white"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          aria-label="Keep this message"
          className="text-[10px] font-semibold text-faint hover:text-ink-2"
        >
          Keep
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setArmed(true)}
      title="Delete this message"
      aria-label="Delete this message"
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faintest ring-1 ring-line-2 transition hover:bg-subtle hover:text-bad"
    >
      <Icon name="close" className="h-3 w-3" />
    </button>
  );
}
