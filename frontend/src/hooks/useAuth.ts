import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getMe, logout, requestMagicLink } from '../api/auth'
import { isUnauthorized } from '../api/client'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    // Being refused is an answer and retrying won't change it; a server that failed to answer
    // (the database waking up, a dropped connection) is worth another go before giving up.
    retry: (failureCount, error) => !isUnauthorized(error) && failureCount < 2,
    retryDelay: 2000,
    staleTime: 1000 * 60 * 5,
  })
}

export function useLogout() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      localStorage.removeItem('access_token')
      // Leave first: clearing the cache doesn't re-render whoever is on screen, so without this
      // the button appeared to do nothing and the signed-in page stayed up.
      navigate('/login', { replace: true })
      qc.clear()
    },
  })
}

export function useRequestMagicLink() {
  return useMutation({ mutationFn: requestMagicLink })
}
