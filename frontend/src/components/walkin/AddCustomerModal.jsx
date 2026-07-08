import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { post } from '../../services/api'

export function AddCustomerModal({ open, initialName = '', onClose, onCreated }) {
  const [fullName, setFullName] = useState(initialName)
  const [address, setAddress] = useState('')
  const [contactNumber, setContactNumber] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setFullName(initialName)
  }, [open, initialName])

  const handleClose = () => {
    setAddress('')
    setContactNumber('')
    setError('')
    onClose()
  }

  const handleSave = async () => {
    if (!fullName.trim()) {
      setError('Full name is required.')
      return
    }

    setError('')
    setSaving(true)
    try {
      const customer = await post('/customers', {
        full_name: fullName.trim(),
        address: address.trim() || null,
        contact_number: contactNumber.trim() || null,
      })
      setAddress('')
      setContactNumber('')
      onCreated(customer)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Customer">
      <div className="flex flex-col gap-3">
        <Input
          id="new-customer-name"
          label="Full Name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoFocus
        />
        <Input
          id="new-customer-address"
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <Input
          id="new-customer-contact"
          label="Contact Number"
          value={contactNumber}
          onChange={(e) => setContactNumber(e.target.value)}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 mt-2">
          <Button type="button" className="flex-1" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save Customer'}
          </Button>
          <Button type="button" variant="secondary" className="flex-1" disabled={saving} onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
