import { useCallback, useEffect, useState } from 'react'

export interface RouteState {
  pathname: string
  search: string
  hash: string
  isApp: boolean
  tab?: string
}

function parseLocation(): RouteState {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
  const search = typeof window !== 'undefined' ? window.location.search : ''
  const hash = typeof window !== 'undefined' ? window.location.hash : ''
  const isApp = pathname.startsWith('/app')
  const params = new URLSearchParams(search)
  const tab = params.get('tab') || undefined

  return {
    pathname,
    search,
    hash,
    isApp,
    tab,
  }
}

export function useRouter() {
  const [route, setRoute] = useState<RouteState>(parseLocation)

  useEffect(() => {
    const handlePop = () => {
      setRoute(parseLocation())
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  const navigate = useCallback((to: string) => {
    if (typeof window === 'undefined') return
    window.history.pushState(null, '', to)
    setRoute(parseLocation())
    // If there's a hash, give DOM a tick to render and scroll
    const hashIndex = to.indexOf('#')
    if (hashIndex !== -1) {
      const targetId = to.slice(hashIndex + 1)
      setTimeout(() => {
        const el = document.getElementById(targetId)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' })
        }
      }, 50)
    } else {
      if (typeof window.scrollTo === 'function') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }
  }, [])

  return {
    ...route,
    navigate,
  }
}
