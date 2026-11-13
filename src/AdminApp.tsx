import { AdminPanel } from './components/AdminPanel'

export default function AdminApp() {
  return (
    <main className="card admin">
      <header className="brand">
        <span className="brand-mark">
          <img src="/icon.svg" alt="" />
        </span>
        <div className="brand-text">
          <h1>Tron Connect</h1>
          <p className="sub">Admin console</p>
        </div>
        <span className="admin-pill">Admin</span>
      </header>

      <AdminPanel />
    </main>
  )
}
