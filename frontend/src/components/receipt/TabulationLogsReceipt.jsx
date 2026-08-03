// TODO: layout placeholder — visual design pending, see planning chat follow-up.

export function TabulationLogsReceipt({ orderNumber, items }) {
  return (
    <div className="order-slip bg-white text-black text-[10pt] leading-tight w-full">
      <div>Tabulation Logs</div>
      <div>Order #: {orderNumber}</div>

      {items.map((item) => (
        <div key={item.id}>
          <div>{item.product_name ?? 'Item'}</div>
          {item.tabulation_breakdown.map((value, index) => (
            <div key={index}>Unit {index + 1}: {Number(value).toFixed(3)} kg</div>
          ))}
          <div>
            Total: {item.tabulation_breakdown
              .reduce((sum, v) => sum + Number(v), 0)
              .toFixed(3)} kg
          </div>
        </div>
      ))}
    </div>
  )
}
