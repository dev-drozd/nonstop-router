import React from 'react';
import type { HealthStatus } from '../../shared/types.js';

interface StatusBadgeProps {
  status: HealthStatus | 'online' | 'offline';
  className?: string;
  showText?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '', showText = true }) => {
  let color = 'bg-status-healthy text-[#2F9E44] border-[rgba(47,158,68,0.25)]';
  let label = 'Healthy';

  if (status === 'cooling_down') {
    color = 'bg-status-warning text-[#F59F00] border-[rgba(245,159,0,0.25)]';
    label = 'Cooling Down';
  } else if (status === 'down' || status === 'offline') {
    color = 'bg-status-error text-[#E03131] border-[rgba(224,49,49,0.25)]';
    label = 'Down';
  } else if (status === 'probing') {
    color = 'bg-[#4DABF7] text-[#4DABF7] border-[rgba(77,171,247,0.25)]';
    label = 'Probing';
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border bg-opacity-10 ${color} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${color.split(' ')[0]}`} />
      {showText && <span>{label}</span>}
    </span>
  );
};
