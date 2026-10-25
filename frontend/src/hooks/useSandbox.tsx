import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { api } from '../lib/api'

interface SandboxCtx {
  /** the relayer exposes the testnet sandbox */
  available: boolean
  presets: string[]
  /** the user switched Judge sandbox mode on */
  on: boolean
  setOn: (v: boolean) => void
}

const Ctx = createContext<SandboxCtx>({ available: false, presets: [], on: false, setOn: () => {} })
const KEY = 'alibi.sandboxMode'

export function SandboxProvider({ children }: { children: ReactNode }) {
  const cfg = useQuery({ queryKey: ['relayer-config'], queryFn: api.config, retry: false, refetchInterval: 30_000 })
  const [on, setOnState] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  const setOn = useCallback((v: boolean) => {
    setOnState(v)
    try {
      localStorage.setItem(KEY, v ? '1' : '0')
    } catch {
      /* a remembered toggle is a convenience only */
    }
  }, [])
  const available = !!cfg.data?.sandbox.enabled
  const value = useMemo(() => ({ available, presets: cfg.data?.sandbox.presets ?? [], on: available && on, setOn }), [available, cfg.data, on, setOn])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useSandbox = () => useContext(Ctx)
