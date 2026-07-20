import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from '../ui/Card'
import { get } from '../../services/api'
import { formatCurrency } from '../../utils/format'

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { product_name, total_revenue } = payload[0].payload
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-sm px-3 py-2 text-sm">
      <div className="font-medium text-gray-900">{product_name}</div>
      <div className="text-gray-600">{formatCurrency(total_revenue)}</div>
    </div>
  )
}

export function TopProductsChart() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'dashboard', 'top-products'],
    queryFn: () => get('/admin/dashboard/top-products'),
  })

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 mb-3">Top 10 Products by Revenue (This Month)</h2>

      {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}

      {!isLoading && data?.length === 0 && (
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-400 text-sm">No sales recorded yet this month</p>
        </div>
      )}

      {!isLoading && data?.length > 0 && (
        <div style={{ width: '100%', height: Math.max(240, data.length * 40) }}>
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={(value) => formatCurrency(value)} tick={{ fontSize: 12 }} />
              <YAxis
                type="category"
                dataKey="product_name"
                width={140}
                tick={{ fontSize: 12 }}
                interval={0}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="total_revenue" fill="#166534" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
