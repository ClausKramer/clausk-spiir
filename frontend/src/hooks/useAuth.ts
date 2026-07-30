import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMe, logout, requestMagicLink } from '../api/auth'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    retry: false,
    staleTime: 1000 * 60 * 5,
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      localStorage.removeItem('access_token')
      qc.clear()
    },
  })
}

export function useRequestMagicLink() {
  return useMutation({ mutationFn: requestMagicLink })
}
