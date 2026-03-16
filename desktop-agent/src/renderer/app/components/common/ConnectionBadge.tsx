import React from 'react';

interface Props {
  source: string | null;
}

export function ConnectionBadge({ source }: Props) {
  if (!source) return null;

  if (source === 'file' || source === 'env') {
    return <span className="badge badge--dev">DEV</span>;
  }
  if (source === 'default') {
    return <span className="badge badge--prod">PROD</span>;
  }
  return null;
}
