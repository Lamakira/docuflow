import React from 'react';
import { EmptyState } from '../components/common/EmptyState';

export function ActivityPage() {
  return (
    <div>
      <div className="page-title">Activity</div>
      <EmptyState icon="📋" title="Coming soon" message="Activity log will appear here." />
    </div>
  );
}
