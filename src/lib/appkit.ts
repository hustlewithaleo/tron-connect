// Must come from the React entry point: its createAppKit also registers the
// instance for useAppKit/useAppKitAccount/useAppKitProvider.
import { createAppKit } from '@reown/appkit/react'
import { TronAdapter } from '@reown/appkit-adapter-tron'
import { tronMainnet } from '@reown/appkit/networks'
import { TrustAdapter } from '@tronweb3/tronwallet-adapter-trust'
import { getBranding, type PublicBranding } from './api'

// WalletConnect registry id for Trust Wallet (supports tron:0x2b6653dc).
// Featuring it puts the official Trust tile and logo first in the modal.
const TRUST_WALLET_ID = '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0'

const DEFAULT_BRANDING: PublicBranding = {
  name: 'Tron Connect',
  description: 'USDT approval on Tron',
  url: null,
  iconUrl: '/icon.svg',
  updatedAt: null,
}

let appKitPromise: Promise<ReturnType<typeof createAppKit>> | null = null

/**
 * Creates AppKit exactly once, after loading the branding the admin may have
 * configured. Must resolve before any AppKit hook/component renders.
 */
export function ensureAppKit(): Promise<ReturnType<typeof createAppKit>> {
  if (!appKitPromise) appKitPromise = initAppKit()
  return appKitPromise
}

async function initAppKit() {
  const projectId = import.meta.env.VITE_WC_PROJECT_ID

  if (!projectId) {
    throw new Error(
      'Missing VITE_WC_PROJECT_ID. Copy .env.example to .env, add your Reown Project ID, then restart the dev server.',
    )
  }

  const origin = window.location.origin
  const branding = await loadBranding()
  const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const configuredUrl =
    branding.url || (isLocalDev ? '' : (import.meta.env.VITE_APP_URL?.trim() ?? ''))
  // Any stored origin is used as-is; the icon still comes from this deployment.
  const appUrl = resolveAppUrl(configuredUrl, origin)
  const iconUrl = new URL(branding.iconUrl, origin).href

  // The Trust adapter only shows up inside Trust's in-app browser. On desktop
  // the WalletConnect option is used instead and the user scans the QR.
  const tronAdapter = new TronAdapter({
    walletAdapters: [new TrustAdapter()],
  })

  return createAppKit({
    adapters: [tronAdapter],
    networks: [tronMainnet],
    defaultNetwork: tronMainnet,
    projectId,
    metadata: {
      name: branding.name,
      description: branding.description,
      url: appUrl,
      icons: [iconUrl],
    },
    featuredWalletIds: [TRUST_WALLET_ID],
    features: { analytics: true, email: false, socials: [] },
  })
}

async function loadBranding(): Promise<PublicBranding> {
  try {
    return await getBranding()
  } catch (err) {
    console.warn('Could not load branding; using defaults.', err)
    return DEFAULT_BRANDING
  }
}

/** Accepts any valid origin; falls back to the current one when unparsable. */
function resolveAppUrl(value: string, origin: string): string {
  if (!value) return origin
  try {
    return new URL(value).origin
  } catch {
    return origin
  }
}
