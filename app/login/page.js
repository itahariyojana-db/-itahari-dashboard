'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Match the dashboard's colour constants (src/App.jsx T object)
const C = {
  red:    '#DC143C',
  blue:   '#003893',
  bg:     '#F2F5FA',
  text:   '#1A2332',
  muted:  '#5A6A7E',
  border: '#D8E0EC',
  sky:    '#E8EEF8',
};

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });

      if (res.ok) {
        // router.refresh() clears Next.js's server-component cache so the
        // dashboard page re-runs its cookie check with the new session.
        router.push('/dashboard');
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'प्रवेश अस्वीकृत।');
      }
    } catch {
      setError('नेटवर्क त्रुटि। पुनः प्रयास गर्नुस्।');
    } finally {
      setLoading(false);
    }
  }

  // ── shared input style ────────────────────────────────────────────────
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '11px 14px',
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
    background: '#fff',
    color: C.text,
    transition: 'border-color .15s',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      fontFamily: "'Noto Sans Devanagari','Mukta',system-ui,sans-serif",
    }}>
      {/* ── Card ─────────────────────────────────────────────────── */}
      <div style={{
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,56,147,0.12)',
        padding: 'clamp(28px,6vw,52px)',
        width: '100%',
        maxWidth: 420,
        border: `1px solid ${C.border}`,
      }}>

        {/* ── Header ───────────────────────────────────────────── */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 68, height: 68, borderRadius: '50%',
            background: C.red, color: '#fff',
            display: 'flex', alignItems: 'center',
            justifyContent: 'center',
            fontSize: 30, margin: '0 auto 14px',
            boxShadow: `0 6px 20px ${C.red}44`,
          }}>🏛</div>
          <h1 style={{
            margin: 0, fontSize: 21,
            fontWeight: 800, color: C.blue,
            lineHeight: 1.2,
          }}>
            इटहरी उपमहानगरपालिका
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: C.muted }}>
            योजना अनुगमन ड्यासबोर्ड
          </p>
        </div>

        {/* ── Divider ──────────────────────────────────────────── */}
        <div style={{
          height: 1, background: C.border,
          margin: '0 -8px 28px',
        }} />

        {/* ── Form ─────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit}>

          {/* Username */}
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block', fontSize: 12,
              fontWeight: 600, color: C.text, marginBottom: 6,
            }}>
              प्रयोगकर्ता नाम
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              placeholder="username"
              style={inputStyle}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: 24 }}>
            <label style={{
              display: 'block', fontSize: 12,
              fontWeight: 600, color: C.text, marginBottom: 6,
            }}>
              पासवर्ड
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              style={inputStyle}
            />
          </div>

          {/* Error banner */}
          {error && (
            <div style={{
              background: '#FFEBEE',
              border: '1px solid #EF9A9A',
              borderLeft: `4px solid ${C.red}`,
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12.5,
              color: '#B71C1C',
              marginBottom: 18,
              fontWeight: 600,
              lineHeight: 1.4,
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '13px',
              background: loading ? C.muted : C.red,
              color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 14,
              fontWeight: 700, fontFamily: 'inherit',
              cursor: loading ? 'wait' : 'pointer',
              transition: 'background .2s, box-shadow .2s',
              boxShadow: loading ? 'none' : `0 4px 14px ${C.red}44`,
              letterSpacing: 0.3,
            }}
          >
            {loading ? 'प्रवेश गर्दैछ…' : 'प्रवेश गर्नुहोस्'}
          </button>
        </form>

        {/* ── Footer note ──────────────────────────────────────── */}
        <p style={{
          margin: '20px 0 0', textAlign: 'center',
          fontSize: 11, color: C.muted,
        }}>
          🔒 सुरक्षित सत्र · अनधिकृत पहुँच निषेध
        </p>
      </div>
    </div>
  );
}
