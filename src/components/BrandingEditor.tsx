import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { getAdminBranding, saveBranding } from '../lib/api'

const MAX_ICON_BYTES = 1_000_000
const ACCEPTED = 'image/png,image/jpeg,image/webp,image/svg+xml'
const ACCEPTED_TYPES = ACCEPTED.split(',')

export function BrandingEditor({ token }: { token: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const [hasIcon, setHasIcon] = useState(false)
  const [currentOrigin, setCurrentOrigin] = useState('')
  const [allowedOrigins, setAllowedOrigins] = useState<string[]>([])
  const [newIcon, setNewIcon] = useState<string | null>(null)
  const [removeIcon, setRemoveIcon] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true

    void (async () => {
      setLoading(true)
      try {
        const branding = await getAdminBranding(token)
        if (!active) return
        applyResponse(branding)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load branding.')
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }

    function applyResponse(branding: Awaited<ReturnType<typeof getAdminBranding>>) {
      setName(branding.name)
      setDescription(branding.description)
      setUrl(branding.url ?? '')
      setIconUrl(branding.iconUrl)
      setHasIcon(branding.hasIcon)
      setCurrentOrigin(branding.currentOrigin)
      setAllowedOrigins(branding.allowedOrigins)
    }
  }, [token])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    setNotice(null)

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Icon must be a PNG, JPEG, WebP or SVG file.')
      return
    }
    if (file.size > MAX_ICON_BYTES) {
      setError('Icon must be 1 MB or smaller.')
      return
    }

    try {
      setNewIcon(await readFileAsDataUrl(file))
      setRemoveIcon(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file.')
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const branding = await saveBranding(token, {
        name: name.trim(),
        description: description.trim(),
        url: url.trim(),
        iconDataUrl: newIcon ?? undefined,
        removeIcon,
      })

      setName(branding.name)
      setDescription(branding.description)
      setUrl(branding.url ?? '')
      setIconUrl(branding.iconUrl)
      setHasIcon(branding.hasIcon)
      setCurrentOrigin(branding.currentOrigin)
      setAllowedOrigins(branding.allowedOrigins)
      setNewIcon(null)
      setRemoveIcon(false)
      if (fileRef.current) fileRef.current.value = ''
      setNotice('Saved. New connections and page reloads will use this branding.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save branding.')
    } finally {
      setSaving(false)
    }
  }

  const preview = newIcon ?? (removeIcon ? '/icon.svg' : (iconUrl ?? '/icon.svg'))

  return (
    <section className="branding-editor">
      <h2>Branding</h2>
      <p className="hint">
        These values are shown in the wallet&apos;s connection prompt. Changing them affects new
        connections after a page reload.
      </p>

      {loading ? (
        <p className="hint">Loading branding…</p>
      ) : (
        <form onSubmit={handleSave}>
          <div className="branding-grid">
            <label>
              <span className="config-key">dApp name</span>
              <input
                value={name}
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
                placeholder="Tron Connect"
                required
              />
            </label>

            <label>
              <span className="config-key">Description</span>
              <input
                value={description}
                maxLength={120}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="USDT approval on Tron"
              />
            </label>

            <label>
              <span className="config-key">URL (origin only)</span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={currentOrigin}
                inputMode="url"
              />
            </label>

            <div className="branding-icon">
              <span className="config-key">Icon</span>
              <div className="icon-row">
                <img className="icon-preview" src={preview} alt="" />
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED}
                  onChange={(event) => void handleFile(event)}
                />
              </div>
              <p className="hint">PNG, JPEG, WebP or SVG up to 1 MB.</p>
              {(hasIcon || newIcon) && (
                <button
                  className="btn small ghost"
                  type="button"
                  onClick={() => {
                    setNewIcon(null)
                    setRemoveIcon(true)
                    if (fileRef.current) fileRef.current.value = ''
                  }}
                >
                  Use default icon
                </button>
              )}
            </div>
          </div>

          <p className="hint">
            Allowed URL origins: <code>{allowedOrigins.join(', ') || currentOrigin || '(none)'}</code>.
            Leave empty to use the origin the site is opened on.
          </p>

          <p className="warning">
            The name, icon and URL identify your dApp to users. Do not impersonate a wallet or
            another service. The URL must match a real origin or the verified-domain badge will
            fail.
          </p>

          {error && <p className="error">{error}</p>}
          {notice && <p className="status-line">{notice}</p>}

          <button className="btn small" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save branding'}
          </button>
        </form>
      )}
    </section>
  )
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}
