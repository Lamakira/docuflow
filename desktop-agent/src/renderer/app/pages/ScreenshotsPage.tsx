import React from 'react';
import { EmptyState } from '../components/common/EmptyState';

export function ScreenshotsPage() {
  return (
    <div>
      <div className="page-title">Screenshots</div>
      <EmptyState icon="📷" title="Coming soon" message="Captured screenshots will appear here." />
    </div>
  );
}
