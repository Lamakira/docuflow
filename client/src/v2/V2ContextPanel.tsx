import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import type { NotificationWithDetails } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  chromeRefusal,
  composeAsk,
  composeNotifications,
  type AskMessageInput,
} from "./chrome";
import { CloseIcon, SendIcon } from "./icons";
import type { V2ChromeLayout, V2CommandPanel } from "./presentation";
import { EMPTY_TIMESHEET_APPROVALS } from "./today";

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
  const [messages, setMessages] = useState<AskMessageInput[]>([]);
  const [input, setInput] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const model = composeAsk({ messages });

  const ask = useMutation({
    mutationFn: async (payload: { message: string; history: Array<{ role: "user" | "assistant"; content: string }> }) => {
      return apiRequest("POST", "/api/chat", {
        message: payload.message,
        conversationHistory: payload.history.map(({ role, content }) => ({ role, content })),
        mode: "both",
      }) as Promise<{ message: string; relevantDocs?: number }>;
    },
    onSuccess: (data) => {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.message, relevantDocs: data.relevantDocs },
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
                {message.source ? <span className="df-ask-source">{message.source}</span> : null}
              </div>
            ),
          )
        )}
        {refusal ? <p className="df-refusal">{refusal}</p> : null}
        <p style={{ fontSize: 11, color: "#59657A" }}>{model.footnote}</p>
      </div>
      <form className="df-ask-composer" onSubmit={onSubmit}>
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
  const { data: notifications = [] } = useQuery<NotificationWithDetails[]>({
    queryKey: ["/api/notifications"],
  });
  const model = composeNotifications({ notifications, now: new Date() });

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
      </div>
      <div className="df-notice-foot">
        <button type="button" className="df-notice-mark" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
          Mark all as read
        </button>
      </div>
    </>
  );
}
