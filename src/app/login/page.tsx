'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { ThemeSelector } from '@/components/ui/theme-selector'

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}

export default function LoginPage() {
  const t = useTranslations('auth')
  const [error, setError] = useState('')
  const [needsSetup, setNeedsSetup] = useState(false)
  const [authV2Enabled, setAuthV2Enabled] = useState(false)
  const [ssoLoading, setSsoLoading] = useState(false)

  // Check setup/auth mode.
  useEffect(() => {
    fetch('/api/setup')
      .then((res) => res.json())
      .then((data) => {
        if (data.needsSetup && !data.authV2) {
          window.location.href = '/setup'
          return
        }
        setNeedsSetup(Boolean(data.needsSetup))
        if (data.authV2) {
          setAuthV2Enabled(true)
        }
      })
      .catch(() => {
        // Ignore — setup check is best-effort
      })
  }, [])

  // If already authenticated (legacy session or bridged AUTH_V2 session),
  // leave /login immediately.
  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => {
        if (res.ok) {
          window.location.href = '/'
        }
      })
      .catch(() => {
        // Ignore — unauthenticated users should remain on login.
      })
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <ThemeSelector />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-card/30 backdrop-blur-sm px-5 py-6 sm:px-6">
        <div className="flex flex-col items-center text-center mb-7">
          <div className="w-12 h-12 rounded-lg overflow-hidden bg-background border border-border/50 flex items-center justify-center mb-3">
            <Image
              src="/brand/mc-logo-128.png"
              alt="Endava Security Champion logo"
              width={48}
              height={48}
              className="h-full w-full object-cover"
              priority
            />
          </div>
          <h1 className="text-xl font-semibold leading-tight text-foreground text-balance max-w-[20rem]">{t('missionControl')}</h1>
          <p className="text-sm text-muted-foreground mt-1.5">{t('signInToContinue')}</p>
        </div>

        {needsSetup && (
          <div className="mb-4 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
            <div className="flex justify-center mb-2">
              <svg className="w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="text-sm font-medium text-blue-200">No admin account exists yet</div>
            <p className="text-xs text-muted-foreground mt-1">
              The first Endava Microsoft account to sign in will be bootstrapped as administrator.
            </p>
          </div>
        )}

        {error && (
          <div role="alert" className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Microsoft SSO button — AUTH_V2 only */}
        {authV2Enabled && (
          <div className="mb-3">
            <button
              type="button"
              onClick={async () => {
                setError('')
                setSsoLoading(true)
                try {
                  const res = await fetch('/api/auth/v2/sign-in/oauth2', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ providerId: 'microsoft-entra-id', callbackURL: '/' }),
                  })
                  if (res.ok) {
                    const data = await res.json()
                    if (data?.url) {
                      window.location.href = data.url
                      return
                    }
                  }
                  setError('Microsoft sign-in unavailable. Try again.')
                } catch {
                  setError(t('networkError'))
                } finally {
                  setSsoLoading(false)
                }
              }}
              disabled={ssoLoading}
              className="w-full h-10 flex items-center justify-center gap-3 rounded-lg border border-border bg-[#0078d4] text-white text-sm font-medium hover:bg-[#106ebe] focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 transition-colors"
            >
              {ssoLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Redirecting...
                </>
              ) : (
                <>
                  <MicrosoftIcon className="w-[18px] h-[18px]" />
                  Sign in with Microsoft
                </>
              )}
            </button>
          </div>
        )}

        {!authV2Enabled && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            Microsoft SSO is currently unavailable. Enable AUTH_V2 to continue.
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground/90 mt-5">{t('orchestrationTagline')}</p>
      </div>
    </div>
  )
}
