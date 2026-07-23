import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, patch, del } from '../services/api'
import { useNotificationStore } from '../store/notificationStore'

function fetchUsers({ search, role, status } = {}) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (role) params.set('role', role)
  if (status) params.set('status', status)
  const queryString = params.toString()
  return get(`/users${queryString ? `?${queryString}` : ''}`)
}

export function useUsersList(filters = {}) {
  const { search, role, status } = filters
  const queryClient = useQueryClient()
  const lastEvent = useNotificationStore((state) => state.lastEvent)

  const query = useQuery({
    queryKey: ['users', 'list', { search, role, status }],
    queryFn: () => fetchUsers({ search, role, status }),
  })

  useEffect(() => {
    if (lastEvent?.type === 'user_changed') {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    }
  }, [lastEvent, queryClient])

  return query
}

export function useUserHistory(userId) {
  return useQuery({
    queryKey: ['users', userId, 'history'],
    queryFn: () => get(`/users/${userId}/history`),
    enabled: !!userId,
  })
}

const ROLE_DISPLAY_ORDER = ['receiver', 'payment', 'releasing', 'admin']

// Role dropdown source for the Create modal. Role is set only at creation and
// is immutable afterward (see CLAUDE.md Team Roles), and there's no dedicated
// roles-list endpoint, so this derives {role_id, role_name} pairs from the
// unfiltered user list — which always has at least one seed account per role.
// Uses the same query key shape as useUsersList({}), so opening the Create
// modal from an unfiltered table costs no extra request.
export function useRoleOptions() {
  const { data: users } = useQuery({
    queryKey: ['users', 'list', { search: undefined, role: undefined, status: undefined }],
    queryFn: () => fetchUsers(),
    staleTime: 5 * 60 * 1000,
  })

  const seen = new Map()
  for (const u of users ?? []) {
    if (!seen.has(u.role_name)) seen.set(u.role_name, u.role_id)
  }
  return ROLE_DISPLAY_ORDER.filter((name) => seen.has(name)).map((role_name) => ({
    role_id: seen.get(role_name),
    role_name,
  }))
}

function useUsersMutation(mutationFn) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useCreateUser() {
  return useUsersMutation((payload) => post('/users', payload))
}

export function useUpdateUser() {
  return useUsersMutation(({ id, ...payload }) => patch(`/users/${id}`, payload))
}

export function useResetPassword() {
  return useUsersMutation(({ id, ...payload }) => post(`/users/${id}/reset-password`, payload))
}

export function useToggleUserStatus() {
  return useUsersMutation((id) => post(`/users/${id}/toggle-status`))
}

export function useDeleteUser() {
  return useUsersMutation((id) => del(`/users/${id}`))
}
