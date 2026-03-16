import React from 'react';

interface Props {
  icon?: string;
  title: string;
  message?: string;
  linkLabel?: string;
  linkUrl?: string;
}

export function EmptyState({ icon, title, message, linkLabel, linkUrl }: Props) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <div className="empty-state__title">{title}</div>
      {message && <div>{message}</div>}
      {linkLabel && linkUrl && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.agentBridge.openExternal(linkUrl);
          }}
        >
          {linkLabel}
        </a>
      )}
    </div>
  );
}
