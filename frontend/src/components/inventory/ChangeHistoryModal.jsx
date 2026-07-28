import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { formatCurrency, formatStock, formatWeight } from '../../utils/format'

// Same palette as Navbar's ROLE_BADGE_STYLES — only releasing/admin can
// write products, so those are the only two entries an audit log ever shows.
const ROLE_TAG_STYLES = {
  releasing: 'bg-orange-100 text-orange-800',
  admin: 'bg-red-100 text-red-800',
}

// One color per ProductChangeTypeEnum value (backend/app/models/product.py) —
// drawn from the same functional-status palette as ui/Badge.jsx, not brand gold.
const ACTION_BADGE_STYLES = {
  created: 'bg-green-100 text-green-800',
  updated: 'bg-blue-100 text-blue-800',
  stock_adjusted: 'bg-purple-100 text-purple-800',
  deactivated: 'bg-red-100 text-red-800',
  reactivated: 'bg-amber-100 text-amber-800',
}

const ACTION_LABELS = {
  created: 'Created',
  updated: 'Updated',
  stock_adjusted: 'Stock Adjusted',
  deactivated: 'Deactivated',
  reactivated: 'Reactivated',
}

// Canonical field order for the Changes column on `updated` rows; any other
// key present in the JSON diff falls back to alphabetical after these.
const FIELD_ORDER = [
  'product_name',
  'brand_name',
  'unit_weight_kg',
  'unit_price_php',
  'stock_quantity',
  'product_status',
]

const FIELD_LABELS = {
  product_name: 'Product Name',
  brand_name: 'Brand Name',
  unit_weight_kg: 'Unit Weight',
  unit_price_php: 'Unit Price',
  stock_quantity: 'Stock',
  product_status: 'Status',
}

function titleCase(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function fieldLabel(key) {
  return FIELD_LABELS[key] || titleCase(key)
}

function formatFieldValue(key, value) {
  switch (key) {
    case 'unit_weight_kg':
      return formatWeight(value)
    case 'unit_price_php':
      return formatCurrency(value)
    case 'stock_quantity':
      return formatStock(value)
    case 'product_status':
      return value === 'active' ? 'Active' : value === 'inactive' ? 'Inactive' : value
    case 'brand_name':
      return value ? value : '—'
    default:
      return value ?? '—'
  }
}

function orderedKeys(obj) {
  const keys = Object.keys(obj)
  const known = FIELD_ORDER.filter((k) => keys.includes(k))
  const rest = keys.filter((k) => !FIELD_ORDER.includes(k)).sort()
  return [...known, ...rest]
}

function formatSignedDelta(delta) {
  const n = Number(delta)
  return `${n >= 0 ? '+' : ''}${n}`
}

function ActionBadge({ type }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${ACTION_BADGE_STYLES[type] || 'bg-gray-100 text-gray-700'}`}
    >
      {ACTION_LABELS[type] || titleCase(type)}
    </span>
  )
}

function RoleTag({ role }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium capitalize ${ROLE_TAG_STYLES[role] || 'bg-gray-100 text-gray-700'}`}
    >
      {role}
    </span>
  )
}

function ChangesCell({ log }) {
  if (log.change_type === 'updated') {
    const oldObj = log.old_value ? JSON.parse(log.old_value) : {}
    const newObj = JSON.parse(log.new_value)
    const keys = orderedKeys(newObj)
    return (
      <div className="flex flex-col gap-0.5">
        {keys.map((key) => (
          <span key={key}>
            {fieldLabel(key)}: {formatFieldValue(key, oldObj[key])} → {formatFieldValue(key, newObj[key])}
          </span>
        ))}
      </div>
    )
  }

  if (log.change_type === 'stock_adjusted') {
    const oldObj = log.old_value ? JSON.parse(log.old_value) : {}
    const newObj = JSON.parse(log.new_value)
    return (
      <div className="flex flex-col gap-0.5">
        <span>
          Stock: {formatStock(oldObj.stock_quantity)} → {formatStock(newObj.stock_quantity)} (
          {formatSignedDelta(log.stock_delta)})
        </span>
        {log.notes && <span>Note: {log.notes}</span>}
      </div>
    )
  }

  return <span className="text-gray-400">—</span>
}

// Presentation-only — the audit log fetch that feeds `history` still lives
// in InventoryView's FieldsPanel; this modal just renders what it's given.
export function ChangeHistoryModal({ open, product, history, loading, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? `Change History — #${product.id}` : 'Change History'}
      size="table"
    >
      <div className="flex flex-col gap-3">
        {loading && <p className="text-sm text-gray-500">Loading...</p>}
        {!loading && history?.length === 0 && <p className="text-sm text-gray-500">No changes yet</p>}
        {!loading && history?.length > 0 && (
          <div className="max-h-[420px] overflow-y-auto pr-1">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">Date/Time</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 font-medium">By</th>
                  <th className="py-2 font-medium">Changes</th>
                </tr>
              </thead>
              <tbody>
                {history.map((log) => (
                  <tr key={log.id} className="border-b border-gray-100 last:border-0 align-top">
                    <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(log.changed_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3">
                      <ActionBadge type={log.change_type} />
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-gray-700">{log.changed_by_full_name}</span>
                        <RoleTag role={log.changed_by_role} />
                      </div>
                    </td>
                    <td className="py-2 text-xs text-gray-600">
                      <ChangesCell log={log} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Button type="button" variant="secondary" className="w-full mt-1" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  )
}
