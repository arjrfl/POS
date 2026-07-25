import { useMemo, useState } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { OrderSummaryPanel } from '../walkin/OrderSummaryPanel'
import { ArticleRows } from './ArticleRows'
import { OriginalTransactionLink } from './OriginalTransactionLink'
import { useCustomer } from '../../hooks/useCustomer'
import { useProducts } from '../../hooks/useProducts'
import { formatCurrency } from '../../utils/format'
import { getTransactionTypeLabel } from '../../utils/transactionType'

export function TransactionDetailPanel({ transaction, onPay, onPark, onSaveAsCredit }) {
  const { data: customer } = useCustomer(transaction?.customer_id)
  const { data: products } = useProducts()
  const [confirmAction, setConfirmAction] = useState(null) // null | 'park'
  const [savingCredit, setSavingCredit] = useState(false)

  const handleSaveAsCredit = async () => {
    setSavingCredit(true)
    try {
      await onSaveAsCredit()
    } finally {
      setSavingCredit(false)
    }
  }

  const productsById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products])

  const displayItems = useMemo(() => {
    if (!transaction) return []
    return transaction.items.map((item) => {
      const product = productsById.get(item.product_id)
      return {
        id: item.id,
        product_name: product?.product_name ?? `Product #${item.product_id}`,
        brand_name: product?.brand_name ?? null,
        unit_count: item.unit_count,
        quantity_kg: Number(item.quantity_kg),
        unit_price: Number(item.unit_price),
        subtotal: Number(item.subtotal),
      }
    })
  }, [transaction, productsById])

  if (!transaction) {
    return (
      <Card className="h-full flex items-center justify-center">
        <p className="text-gray-500 italic">Select a transaction from the queue to process it</p>
      </Card>
    )
  }

  const isAdjustment = transaction.transaction_type === 'adjustment'
  const isRefund = transaction.transaction_type === 'refund'
  const isAdjustmentChild = isAdjustment || isRefund

  return (
    <>
      <OrderSummaryPanel
        orderNumber={transaction.order_number}
        headingLabel={null}
        headerBadge={
          isAdjustment ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold uppercase bg-red-100 text-red-700">
              {getTransactionTypeLabel('adjustment')}
            </span>
          ) : isRefund ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold uppercase bg-blue-100 text-blue-700">
              {getTransactionTypeLabel('refund')}
            </span>
          ) : null
        }
        headerSubtext={isAdjustmentChild ? <OriginalTransactionLink transaction={transaction} /> : null}
        customer={customer}
        customerType={transaction.customer_type}
        items={isAdjustmentChild ? [] : displayItems}
        itemsTable={isAdjustmentChild ? <ArticleRows transaction={transaction} /> : null}
        total={Number(transaction.total_due)}
        totalLabel="TOTAL DUE"
        readOnly
        footer={
          <div className="flex flex-col gap-2 mt-4">
            {(isAdjustment || isRefund) && (
              <div
                className={`rounded-md p-3 text-sm ${
                  isAdjustment ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-blue-50 border border-blue-200 text-blue-800'
                }`}
              >
                <p>
                  {isAdjustment
                    ? `Customer owes ${formatCurrency(transaction.total_due)} extra for weight variance`
                    : `Store owes customer ${formatCurrency(transaction.total_due)} for weight variance`}
                </p>
                {isAdjustment && (
                  <p className="text-xs mt-1">Collect the extra amount using the normal payment flow.</p>
                )}
              </div>
            )}
            {isRefund ? (
              <Button
                type="button"
                variant="success"
                className="w-full"
                disabled={savingCredit}
                onClick={handleSaveAsCredit}
              >
                {savingCredit ? 'Saving...' : 'Save as Credit'}
              </Button>
            ) : (
              <div className="flex flex-row gap-2">
                <div className="flex-1 flex flex-col">
                  <Button type="button" className="w-full" onClick={onPay}>
                    Pay
                  </Button>
                  {transaction.payment_drafts?.length > 0 && (
                    <p className="text-xs text-amber-600 text-center mt-1">
                      Resume Payment ({transaction.payment_drafts.length} entries)
                    </p>
                  )}
                </div>
                <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmAction('park')}>
                  Park
                </Button>
              </div>
            )}
          </div>
        }
      />

      <Modal open={confirmAction === 'park'} onClose={() => setConfirmAction(null)} title="Park Transaction?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-700">Park this transaction? You will be able to return to it later.</p>
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                setConfirmAction(null)
                onPark()
              }}
            >
              Yes, Park
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
