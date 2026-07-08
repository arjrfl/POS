import { useEffect, useState } from 'react'
import { usePaymentMethods } from '../../hooks/usePaymentMethods'
import { Input } from '../ui/Input'
import { formatCurrency } from '../../utils/currency'

const SELECT_CLASSES =
  'px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light'

export function PaymentMethodForm({ totalDue, onChange }) {
  const { data: methods } = usePaymentMethods()
  const [mode, setMode] = useState('cash')

  const cashMethod = methods?.find((m) => m.payment_method_name === 'cash')
  const onlineMethods = methods?.filter((m) => m.payment_method_name !== 'cash') ?? []

  const [cashTendered, setCashTendered] = useState('')

  const [onlineMethodId, setOnlineMethodId] = useState('')
  const [onlineRef, setOnlineRef] = useState('')

  const [splitCashAmount, setSplitCashAmount] = useState('')
  const [splitCashTendered, setSplitCashTendered] = useState('')
  const [splitOnlineMethodId, setSplitOnlineMethodId] = useState('')
  const [splitOnlineAmount, setSplitOnlineAmount] = useState('')
  const [splitOnlineRef, setSplitOnlineRef] = useState('')

  useEffect(() => {
    if (onlineMethods.length && !onlineMethodId) setOnlineMethodId(String(onlineMethods[0].id))
    if (onlineMethods.length && !splitOnlineMethodId) setSplitOnlineMethodId(String(onlineMethods[0].id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methods])

  useEffect(() => {
    if (!cashMethod) return

    if (mode === 'cash') {
      const tendered = Number(cashTendered) || 0
      const valid = totalDue > 0 && tendered >= totalDue
      onChange({
        payments: [{ payment_method_id: cashMethod.id, amount: totalDue, tendered_amount: tendered }],
        isValid: valid,
        changeGiven: valid ? tendered - totalDue : 0,
      })
      return
    }

    if (mode === 'online') {
      const valid = totalDue > 0 && !!onlineMethodId && onlineRef.trim().length > 0
      onChange({
        payments: [{ payment_method_id: Number(onlineMethodId), amount: totalDue, ref_number: onlineRef.trim() }],
        isValid: valid,
        changeGiven: 0,
      })
      return
    }

    // split
    const cashAmt = Number(splitCashAmount) || 0
    const onlineAmt = Number(splitOnlineAmount) || 0
    const tendered = Number(splitCashTendered) || 0
    const sumsCorrectly = Math.abs(cashAmt + onlineAmt - totalDue) < 0.005
    const cashPortionValid = cashAmt === 0 || tendered >= cashAmt
    const onlinePortionValid = onlineAmt === 0 || (!!splitOnlineMethodId && splitOnlineRef.trim().length > 0)
    const valid = totalDue > 0 && sumsCorrectly && cashPortionValid && onlinePortionValid && (cashAmt > 0 || onlineAmt > 0)

    const payments = []
    if (cashAmt > 0) payments.push({ payment_method_id: cashMethod.id, amount: cashAmt, tendered_amount: tendered })
    if (onlineAmt > 0) {
      payments.push({
        payment_method_id: Number(splitOnlineMethodId),
        amount: onlineAmt,
        ref_number: splitOnlineRef.trim(),
      })
    }

    onChange({ payments, isValid: valid, changeGiven: valid ? tendered - cashAmt : 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    cashTendered,
    onlineMethodId,
    onlineRef,
    splitCashAmount,
    splitCashTendered,
    splitOnlineMethodId,
    splitOnlineAmount,
    splitOnlineRef,
    totalDue,
    cashMethod,
  ])

  const splitTotal = (Number(splitCashAmount) || 0) + (Number(splitOnlineAmount) || 0)
  const splitMatches = Math.abs(splitTotal - totalDue) < 0.005

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {['cash', 'online', 'split'].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-4 py-2 rounded-md text-sm font-medium border capitalize ${
              mode === m
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'cash' && (
        <div className="flex flex-col gap-2">
          <Input
            id="cash-tendered"
            label="Cash tendered"
            type="number"
            step="0.01"
            min="0"
            value={cashTendered}
            onChange={(e) => setCashTendered(e.target.value)}
          />
          <div className="text-sm text-gray-700">
            Change to give: <strong>{formatCurrency(Math.max(0, (Number(cashTendered) || 0) - totalDue))}</strong>
          </div>
        </div>
      )}

      {mode === 'online' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="online-method" className="text-sm font-medium text-gray-700">
              Payment method
            </label>
            <select
              id="online-method"
              className={SELECT_CLASSES}
              value={onlineMethodId}
              onChange={(e) => setOnlineMethodId(e.target.value)}
            >
              {onlineMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.payment_method_name}
                </option>
              ))}
            </select>
          </div>
          <Input
            id="online-ref"
            label="Reference number"
            value={onlineRef}
            onChange={(e) => setOnlineRef(e.target.value)}
          />
          <div className="text-sm text-gray-700">
            Amount: <strong>{formatCurrency(totalDue)}</strong>
          </div>
        </div>
      )}

      {mode === 'split' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-700">Cash portion</span>
            <div className="flex gap-3">
              <Input
                id="split-cash-amount"
                label="Cash amount"
                type="number"
                step="0.01"
                min="0"
                value={splitCashAmount}
                onChange={(e) => setSplitCashAmount(e.target.value)}
                className="w-32"
              />
              <Input
                id="split-cash-tendered"
                label="Tendered"
                type="number"
                step="0.01"
                min="0"
                value={splitCashTendered}
                onChange={(e) => setSplitCashTendered(e.target.value)}
                className="w-32"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-700">Online portion</span>
            <div className="flex flex-col gap-1">
              <label htmlFor="split-online-method" className="text-sm font-medium text-gray-700">
                Payment method
              </label>
              <select
                id="split-online-method"
                className={SELECT_CLASSES}
                value={splitOnlineMethodId}
                onChange={(e) => setSplitOnlineMethodId(e.target.value)}
              >
                {onlineMethods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.payment_method_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <Input
                id="split-online-amount"
                label="Online amount"
                type="number"
                step="0.01"
                min="0"
                value={splitOnlineAmount}
                onChange={(e) => setSplitOnlineAmount(e.target.value)}
                className="w-32"
              />
              <Input
                id="split-online-ref"
                label="Reference number"
                value={splitOnlineRef}
                onChange={(e) => setSplitOnlineRef(e.target.value)}
              />
            </div>
          </div>

          <div className={`text-sm font-medium ${splitMatches ? 'text-green-700' : 'text-red-600'}`}>
            Total entered: {formatCurrency(splitTotal)} / {formatCurrency(totalDue)}
          </div>
        </div>
      )}
    </div>
  )
}
