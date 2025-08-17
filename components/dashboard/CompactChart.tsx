'use client';

import { 
  BarChart, 
  Bar, 
  PieChart, 
  Pie, 
  Cell, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

interface CompactChartProps {
  title: string;
  type: 'bar' | 'pie' | 'line';
  data: any[];
  height?: number;
}

const COLORS = ['#F2811D', '#F27127', '#732002', '#F59E0B', '#22C55E', '#EF4444'];

export default function CompactChart({ title, type, data, height = 180 }: CompactChartProps) {
  const renderChart = () => {
    switch (type) {
      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={30}
                outerRadius={60}
                paddingAngle={5}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        );
      
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              <XAxis 
                dataKey="day" 
                axisLine={false} 
                tickLine={false}
                tick={{ fontSize: 12, fill: '#6B7280' }}
              />
              <YAxis hide />
              <Tooltip />
              <Line 
                type="monotone" 
                dataKey="properties" 
                stroke="#F2811D" 
                strokeWidth={3}
                dot={{ fill: '#F2811D', strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, stroke: '#F2811D', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        );
      
      case 'bar':
      default:
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data}>
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false}
                tick={{ fontSize: 11, fill: '#6B7280' }}
              />
              <YAxis hide />
              <Tooltip />
              <Bar 
                dataKey="value" 
                fill="#F2811D" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {type === 'pie' && (
          <div className="flex gap-2">
            {data.map((item, index) => (
              <div key={index} className="flex items-center gap-1">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="text-xs text-gray-600">{item.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div className="relative">
        {renderChart()}
      </div>
      
      {/* Summary info */}
      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="flex justify-between text-sm text-gray-600">
          <span>סך הכל</span>
          <span className="font-medium">
            {type === 'pie' 
              ? data.reduce((sum, item) => sum + item.value, 0)
              : data.length > 0 ? Math.max(...data.map(item => item.value || item.properties || 0)) : 0
            }
          </span>
        </div>
      </div>
    </div>
  );
}