import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import type { NotificationWithDetails } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ASK_CHAT_MODE,
  chromeRefusal,
  composeAsk,
  composeDeliveryPreference,
  composeNotifications,
  toggleDeliveryPreference,
  type AskCitationInput,
  type AskMessageInput,
  type DeliveryCategoryId,
} from "./chrome";
import { CloseIcon, SendIcon } from "./icons";
import { motionForSurface } from "./motion";
import type { V2ChromeLayout, V2CommandPanel } from "./presentation";
import { EMPTY_TIMESHEET_APPROVALS } from "./today";
import { useV2Chrome } from "./V2Shell";

const ASK_COMPOSER_MOTION = motionForSurface("ask-composer").enterExit;
const NOTICE_MOTION = motionForSurface("notification-inbox").enterExit;
const DELIVERY_MOTION = motionForSurface("delivery-preference").enterExit;

export function V2ContextPanel({
  panel,
  onClose,
  surface = "side-panel",
}: {
  panel: V2CommandPanel;
  onClose: () => void;
  surface?: V2ChromeLayout["context"];
}) {
  const sheet = surface === "sheet";
  const ask = composeAsk({ messages: [] });
  const title =
    panel === "ask" ? ask.title : panel === "approvals" ? EMPTY_TIMESHEET_APPROVALS.title : "Notifications";
  const kicker =
    panel === "ask" ? ask.kicker : panel === "approvals" ? EMPTY_TIMESHEET_APPROVALS.kicker : "INBOX";

  return (
    <aside
      className={sheet ? "df-sheet" : "df-panel"}
      data-testid={sheet ? `v2-sheet-${panel}` : `v2-panel-${panel}`}
      aria-label={title}
    >
      {sheet ? (
        <button type="button" className="df-sheet-handle" aria-label="Close" onClick={onClose} />
      ) : null}
      <header
        style={{
          padding: sheet ? "12px 16px 13px" : "14px 16px",
          borderBottom: "1px solid #D8DEE6",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="df-mono" style={{ fontSize: 10, color: "#59657A", letterSpacing: "0.08em" }}>
            {kicker}
          </div>
          <div
            style={{
              fontFamily: "var(--df-font-display)",
              fontWeight: 700,
              fontSize: sheet ? 19 : 18,
            }}
          >
            {title}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          style={{ background: "transparent", border: 0, cursor: "pointer", padding: 4 }}
        >
          <CloseIcon />
        </button>
      </header>
      {panel === "approvals" ? (
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          <p style={{ fontSize: 14, lineHeight: 1.55, maxWidth: "62ch", color: "#59657A" }}>
            {EMPTY_TIMESHEET_APPROVALS.copy}
          </p>
        </div>
      ) : panel === "ask" ? (
        <AskBody />
      ) : (
        <NotificationsBody onClose={onClose} />
      )}
      {sheet && panel !== "ask" ? (
        <div className="df-sheet-foot">
          <button type="button" className="df-ghost-btn df-sheet-btn" onClick={onClose}>
            Close
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function AskBody() {
  const { memberships } = useV2Chrome();
  const workspaceId = memberships?.activeWorkspaceId;
  const [messages, setMessages] = useState<AskMessageInput[]>([]);
  const [input, setInput] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const model = composeAsk({ messages });

  useEffect(() => {
    setMessages([]);
    setRefusal(null);
  }, [workspaceId]);

  const ask = useMutation({
    mutationFn: async (payload: { message: string; history: Array<{ role: "user" | "assistant"; content: string }> }) => {
      return apiRequest("POST", "/api/chat", {
        message: payload.message,
        conversationHistory: payload.history.map(({ role, content }) => ({ role, content })),
        mode: ASK_CHAT_MODE,
      }) as Promise<{ message: string; relevantDocs?: number; citations?: AskCitationInput[] }>;
    },
    onSuccess: (data) => {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.message,
          relevantDocs: data.relevantDocs,
          citations: data.citations,
        },
      ]);
      setRefusal(null);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Ask DocuFlow could not answer.";
      setRefusal(chromeRefusal({ kind: "generic", message }));
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || ask.isPending) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: message }]);
    setInput("");
    ask.mutate({ message, history });
  }

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {model.messages.length === 0 ? (
          <p style={{ fontSize: 14, lineHeight: 1.55, maxWidth: "62ch", color: "#59657A" }}>{model.emptyCopy}</p>
        ) : (
          model.messages.map((message, index) =>
            message.role === "user" ? (
              <div key={`user-${index}`} className="df-ask-user">
                {message.content}
              </div>
            ) : (
              <div key={`assistant-${index}`} className="df-ask-answer">
                <span>{message.content}</span>
                {message.sources.length > 0 ? (
                  <ul className="df-ask-sources">
                    {message.sources.map((source) => (
                      <li key={source.id}>
                        <Link href={source.href} className="df-ask-source">
                          {source.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : message.source ? (
                  <span className="df-ask-source">{message.source}</span>
                ) : null}
              </div>
            ),
          )
        )}
        {refusal ? <p className="df-refusal">{refusal}</p> : null}
        <p style={{ fontSize: 11, color: "#59657A" }}>{model.footnote}</p>
      </div>
      <form className="df-ask-composer" onSubmit={onSubmit} data-motion={ASK_COMPOSER_MOTION}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about a Project, Client, or policy…"
          aria-label="Ask DocuFlow"
        />
        <button type="submit" className="df-ask-send" aria-label="Send" disabled={ask.isPending || !input.trim()}>
          <SendIcon />
        </button>
      </form>
    </>
  );
}

function NotificationsBody({ onClose }: { onClose: () => void }) {
  const { memberships } = useV2Chrome();
  const workspaceId = memberships?.activeWorkspaceId ?? "workspace";
  const workspaceName =
    memberships?.memberships.find((row) => row.workspaceId === workspaceId)?.workspaceName ?? "Workspace";
  const { data: notifications = [] } = useQuery<NotificationWithDetails[]>({
    queryKey: ["/api/notifications"],
  });
  const { data: deliveryPreference } = useQuery<{
    emailByCategory: Partial<Record<DeliveryCategoryId, boolean>>;
  }>({
    queryKey: ["/api/notifications/delivery-preferences", workspaceId],
    queryFn: async () => apiRequest("GET", "/api/notifications/delivery-preferences"),
  });
  const model = composeNotifications({ notifications, now: new Date() });
  const knownIds = useRef<Set<string> | null>(null);
  const [entering, setEntering] = useState<Set<string>>(() => new Set());
  const emailByCategory = deliveryPreference?.emailByCategory ?? {};
  const delivery = composeDeliveryPreference({ workspaceName, emailByCategory });

  useEffect(() => {
    const ids = model.rows.map((row) => row.id);
    if (knownIds.current === null) {
      knownIds.current = new Set(ids);
      return;
    }
    const next = new Set<string>();
    for (const id of ids) {
      if (!knownIds.current.has(id)) next.add(id);
    }
    knownIds.current = new Set(ids);
    if (next.size > 0) setEntering(next);
  }, [model.rows]);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAll = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const saveDelivery = useMutation({
    mutationFn: async (next: Partial<Record<DeliveryCategoryId, boolean>>) => {
      await apiRequest("PUT", "/api/notifications/delivery-preferences", { emailByCategory: next });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/delivery-preferences"] });
    },
  });

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {model.rows.length === 0 ? (
          <p style={{ padding: 16, fontSize: 14, lineHeight: 1.55, color: "#59657A" }}>{model.emptyCopy}</p>
        ) : (
          model.rows.map((row) => (
            <Link
              key={row.id}
              href={row.href}
              className="df-notice-row"
              data-unread={row.unread ? "true" : "false"}
              data-enter={entering.has(row.id) ? "true" : undefined}
              data-motion={entering.has(row.id) ? NOTICE_MOTION : undefined}
              onClick={() => {
                if (row.unread) markRead.mutate(row.id);
                onClose();
              }}
            >
              <span className="df-mono" style={{ fontSize: 10, color: "#59657A", letterSpacing: "0.06em" }}>
                {row.kind}
              </span>
              <span style={{ fontWeight: 500, fontSize: 13 }}>{row.title}</span>
              <span className="df-mono" style={{ fontSize: 10.5, color: "#59657A" }}>
                {row.when}
                {row.origin ? ` · ${row.origin}` : ""}
              </span>
            </Link>
          ))
        )}
        <section className="df-delivery" data-testid="v2-delivery-preference">
          <div className="df-mono" style={{ fontSize: 10, color: "#59657A", letterSpacing: "0.08em" }}>
            {delivery.kicker}
          </div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{delivery.title}</div>
          <p style={{ fontSize: 12, lineHeight: 1.5, color: "#59657A", margin: 0 }}>{delivery.copy}</p>
          {delivery.rows.map((row) => (
            <div key={row.id} className="df-delivery-row">
              <span style={{ fontSize: 13, fontWeight: 500 }}>{row.label}</span>
              <span className="df-mono" style={{ fontSize: 10, color: "#59657A" }}>
                Inbox on
              </span>
              <button
                type="button"
                className="df-delivery-toggle"
                role="switch"
                aria-checked={row.email.on}
                aria-label={`Email for ${row.label}`}
                disabled={row.email.locked}
                data-motion={DELIVERY_MOTION}
                onClick={() => {
                  saveDelivery.mutate(
                    toggleDeliveryPreference(emailByCategory, {
                      category: row.id,
                      email: !row.email.on,
                    }),
                  );
                }}
              >
                Email {row.email.on ? "on" : "off"}
              </button>
            </div>
          ))}
        </section>
      </div>
      <div className="df-notice-foot">
        <button
          type="button"
          className="df-notice-mark"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending || model.unreadCount === 0}
        >
          Mark all as read
        </button>
      </div>
    </>
  );
}
