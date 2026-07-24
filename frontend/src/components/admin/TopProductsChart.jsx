import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Card } from '../ui/Card'
import { get } from '../../services/api'
import { formatCurrency } from '../../utils/format'

// Fixed categorical palette, one color per rank position (1st highest
// revenue product = index 0, etc.) — assigned by slice position so the
// mapping stays consistent month to month even as top products change.
const PIE_COLORS = [
  '#2E7D32', // green
  '#1565C0', // blue
  '#EF6C00', // orange
  '#8E24AA', // purple
  '#C62828', // red
  '#00838F', // teal
  '#F9A825', // amber
  '#5D4037', // brown
  '#455A64', // blue-grey
  '#AD1457', // pink
]

function ChartTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null
  const { product_name, total_revenue } = payload[0].payload
  const percent = total > 0 ? ((total_revenue / total) * 100).toFixed(1) : '0.0'
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-sm px-3 py-2 text-sm">
      <div className="font-medium text-gray-900">{product_name}</div>
      <div className="text-gray-600">{formatCurrency(total_revenue)}</div>
      <div className="text-gray-400 text-xs">{percent}% of total</div>
    </div>
  )
}

export function TopProductsChart() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'dashboard', 'top-products'],
    queryFn: () => get('/admin/dashboard/top-products'),
  })

  const chartData = useMemo(
    () => (data ?? []).map((row) => ({ ...row, total_revenue: Number(row.total_revenue) })),
    [data],
  )
  const total = useMemo(() => chartData.reduce((sum, row) => sum + row.total_revenue, 0), [chartData])

  return (
    <Card className="h-full flex flex-col">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">Top 10 Products by Revenue (This Month)</h2>

      {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}

      {!isLoading && chartData.length === 0 && (
        <div className="flex items-center justify-center flex-1">
          <p className="text-gray-400 text-sm">No sales recorded yet this month</p>
        </div>
      )}

      {!isLoading && chartData.length > 0 && (
        <div className="flex-1 min-h-0 flex items-center gap-4">
          <div className="flex-1 min-h-0 h-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="total_revenue"
                  nameKey="product_name"
                  cx="50%"
                  cy="50%"
                  outerRadius="80%"
                  strokeWidth={1}
                  stroke="#ffffff"
                  isAnimationActive={false}
                >
                  {chartData.map((row, index) => (
                    <Cell key={row.product_id} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="w-2/5 h-full overflow-y-auto pr-1">
            {chartData.map((row, index) => (
              <div key={row.product_id} className="flex items-center gap-2 py-1.5 text-sm">
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                />
                <span className="text-gray-900 truncate flex-1">{row.product_name}</span>
                <span className="text-gray-600 flex-shrink-0">{formatCurrency(row.total_revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
