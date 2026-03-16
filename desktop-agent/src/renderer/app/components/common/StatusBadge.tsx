import React from 'react';
import { TimerStatus } from '../../types';

interface Props {
  status: TimerStatus;
}

const LABELS: Record<TimerStatus, string> = {
  running: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
};

export function StatusBadge({ status }: Props) {
  return (
    <span className={`badge badge--${status}`}>{LABELS[status]}</span>
  );
}
