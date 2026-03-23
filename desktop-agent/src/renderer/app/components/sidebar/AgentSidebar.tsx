import React from 'react';
import { useAgent } from '../../stores/AgentContext';
import { AppPage } from '../../types';
import { ConnectionBadge } from '../common/ConnectionBadge';

const NAV_ITEMS: { page: AppPage; icon: string; label: string }[] = [
  { page: 'timer', icon: '▶', label: 'Timer' },
  { page: 'activity', icon: '☰', label: 'Activity' },
  { page: 'screenshots', icon: '⎙', label: 'Screenshots' },
  { page: 'settings', icon: '⚙', label: 'Settings' },
];

export function AgentSidebar() {
  const { state, dispatch } = useAgent();
  const { page } = state;
  const isPaired = state.agentState?.isPaired ?? false;
  const userEmail = state.agentState?.userEmail ?? null;
  const apiBaseSource = state.agentState?.apiBaseSource ?? null;
  const apiBase = state.agentState?.apiBase ?? null;

  const initial = userEmail ? userEmail[0].toUpperCase() : '?';

  return (
    <nav className="sidebar">
      <div className="sidebar__avatar" title={userEmail ?? ''}>
        {initial}
      </div>
      <div className="sidebar__divider" />
      <div className="sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.page}
            className={`sidebar__item${page === item.page ? ' sidebar__item--active' : ''}`}
            title={item.label}
            onClick={() => dispatch({ type: 'SET_PAGE', page: item.page })}
          >
            {item.icon}
          </button>
        ))}
      </div>
      <div className="sidebar__footer">
        <ConnectionBadge source={apiBaseSource} />
        <div
          className={`sidebar__dot${isPaired ? ' sidebar__dot--connected' : ''}`}
          title={isPaired ? 'Connected' : 'Not connected'}
        />
      </div>
    </nav>
  );
}
