import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import logo from '../../assets/lash-meatshop-logo-white.png'

const ROLE_BADGE_STYLES = {
  receiver: 'bg-blue-100 text-blue-800',
  payment: 'bg-yellow-100 text-yellow-800',
  releasing: 'bg-orange-100 text-orange-800',
  admin: 'bg-red-100 text-red-800',
  operations: 'bg-purple-100 text-purple-800',
}

export function Navbar({ title, actions }) {
  const { user, logout } = useAuth()
  const [confirmLogout, setConfirmLogout] = useState(false)

  return (
    <header className="grid grid-cols-3 items-center gap-4 px-6 py-3 bg-brand-black text-brand-white">
      <div className="flex items-center gap-3">
        <img src={logo} alt="Lash Meatshop" className="h-8 w-8 object-contain" />
        <span className="font-semibold">Lash Meatshop POS</span>
      </div>

      <h1 className="text-center font-medium truncate">{title}</h1>

      <div className="flex items-center justify-end gap-3">
        {user && (
          <>
            <span className="text-sm">{user.full_name}</span>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_BADGE_STYLES[user.role_name] || 'bg-gray-100 text-gray-700'}`}
            >
              {user.role_name?.replace('_', ' ')}
            </span>
          </>
        )}
        {actions}
        <Button
          variant="secondary"
          className="!border-brand-gold !text-brand-gold hover:!bg-brand-gold hover:!text-brand-black"
          onClick={() => setConfirmLogout(true)}
        >
          Log out
        </Button>
      </div>

      <Modal open={confirmLogout} onClose={() => setConfirmLogout(false)} title="Log Out">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-700">Are you sure you want to log out?</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              onClick={() => {
                setConfirmLogout(false)
                logout()
              }}
            >
              Log Out
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmLogout(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </header>
  )
}
