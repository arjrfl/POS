import { useMemo, useState } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { OrderSummaryPanel } from '../walkin/OrderSummaryPanel'
import { useCustomer } from '../../hooks/useCustomer'
import { useProducts } from '../../hooks/useProducts'

export function TransactionDetailPanel({ transaction, onPay, onPark, onReturnToReceiver }) {
  const { data: customer } = useCustomer(transaction?.customer_id)
  const { data: products } = useProducts()
  const [confirmAction, setConfirmAction] = useState(null) // null | 'return' | 'park'

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

  return (
    <>
      <OrderSummaryPanel
        orderNumber={transaction.order_number}
        headingLabel={null}
        customer={customer}
        customerType={transaction.customer_type}
        items={displayItems}
        total={Number(transaction.total_due)}
        totalLabel="TOTAL DUE"
        readOnly
        footer={
          <div className="flex flex-col gap-2 mt-4">
            <Button type="button" className="w-full" onClick={onPay}>
              Pay
            </Button>
            {transaction.customer_type === 'walk_in' && (
              <Button type="button" variant="warning" className="w-full" onClick={() => setConfirmAction('return')}>
                Return to Receiver
              </Button>
            )}
            <Button type="button" variant="outline" className="w-full" onClick={() => setConfirmAction('park')}>
              Park
            </Button>
          </div>
        }
      />

      <Modal open={confirmAction === 'return'} onClose={() => setConfirmAction(null)} title="Return to Receiver?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-700">
            This will send the order back to the Receiver team for editing. The customer will need to return to the
            counter.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                setConfirmAction(null)
                onReturnToReceiver()
              }}
            >
              Yes, Return
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

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
