import Link from 'next/link';
import { type LucideIcon } from 'lucide-react';

interface ModernKpiCardProps {
  title: string;
  value: string;
  change: string;
  trend: 'up' | 'down' | 'neutral';
  icon: LucideIcon;
  color: 'blue' | 'green' | 'purple' | 'orange' | 'red';
  href?: string;
}

const colorVariants = {
  blue: {
    bg: 'bg-gradient-to-br from-brand-bg to-orange-50',
    border: 'border-brand-border',
    icon: 'bg-brand-primary text-white',
    value: 'text-brand-accent',
    change: 'text-brand-inkMuted'
  },
  green: {
    bg: 'bg-gradient-to-br from-green-50 to-brand-bg',
    border: 'border-brand-border',
    icon: 'bg-brand-success text-white',
    value: 'text-brand-accent',
    change: 'text-brand-inkMuted'
  },
  purple: {
    bg: 'bg-gradient-to-br from-brand-bg to-purple-50',
    border: 'border-brand-border',
    icon: 'bg-brand-primaryMuted text-white',
    value: 'text-brand-accent',
    change: 'text-brand-inkMuted'
  },
  orange: {
    bg: 'bg-gradient-to-br from-orange-50 to-orange-100',
    border: 'border-orange-200',
    icon: 'bg-brand-primary text-white',
    value: 'text-brand-accent',
    change: 'text-brand-primaryMuted'
  },
  red: {
    bg: 'bg-gradient-to-br from-red-50 to-brand-bg',
    border: 'border-brand-border',
    icon: 'bg-brand-error text-white',
    value: 'text-brand-accent',
    change: 'text-brand-inkMuted'
  }
};

export default function ModernKpiCard({ 
  title, 
  value, 
  change, 
  trend, 
  icon: Icon, 
  color, 
  href 
}: ModernKpiCardProps) {
  const colors = colorVariants[color];
  
  const content = (
    <div className={`${colors.bg} ${colors.border} border rounded-xl p-6 transition-all duration-200 hover:shadow-md hover:scale-105`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`${colors.icon} p-3 rounded-lg`}>
          <Icon className="h-6 w-6" />
        </div>
        {trend === 'up' && (
          <div className="text-green-500 text-sm">↗</div>
        )}
        {trend === 'down' && (
          <div className="text-red-500 text-sm">↘</div>
        )}
      </div>
      
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-600">{title}</h3>
        <p className={`text-3xl font-bold ${colors.value}`}>{value}</p>
        <p className={`text-sm ${colors.change}`}>{change}</p>
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}