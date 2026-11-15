import { useEffect, useState } from 'react';
import { RefreshCw, Eye, EyeOff } from 'lucide-react';
import { api, post, setAccessToken } from '../../lib/api';
import { Field, Notice, Spinner } from '../../components/ui';
export function Auth({ onLogin, compact = false }) {
  const [setup, setSetup] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [showPassword, setShowPassword] = useState(false),
    [form, setForm] = useState({
      name: '',
      shopName: 'Rafiq Jewellery',
      email: '',
      password: '',
      setupKey: '',
    });
  const check = () => {
    setError('');
    api('/auth/status')
      .then((d) => setSetup(d.setupRequired))
      .catch((e) => setError(e.message));
  };
  useEffect(check, []);
  async function login() {
    setBusy(true);
    setError('');
    try {
      const data = await post(
        setup ? '/auth/setup' : '/auth/login',
        setup ? form : { email: form.email, password: form.password },
      );
      setAccessToken(data.token, data.expiresAt);
      onLogin(data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const input = (key, label, type = 'text') => (
    <Field key={key} label={label} required>
      <input
        type={type}
        required
        value={form[key]}
        autoComplete={
          key === 'password'
            ? setup
              ? 'new-password'
              : 'current-password'
            : key === 'email'
              ? 'username'
              : 'off'
        }
        minLength={key === 'password' ? 6 : key === 'setupKey' ? 16 : undefined}
        maxLength={key === 'password' ? 72 : 254}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <div className={compact ? 'auth-compact' : 'auth-page'}>
      <div className="auth-card">
        {!compact && (
          <div className="auth-brand">
            <span className="brand-icon brand-monogram" aria-label="Rafiq Jewellery">
              RJ
            </span>
            <h1>Rafiq Jewellery</h1>
          </div>
        )}
        <h2>{setup ? 'Create administrator' : 'Sign in'}</h2>
        {error && <Notice error>{error}</Notice>}
        {setup === null ? (
          <button className="btn secondary full" onClick={check}>
            <RefreshCw size={16} />
            Reconnect
          </button>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                login();
              }}
            >
              {setup && (
                <>
                  {input('name', 'Your name')}
                  {input('shopName', 'Shop name')}
                </>
              )}
              <fieldset className="auth-credentials">
                <legend>Account details</legend>
                {input('email', 'Email', 'email')}
                <div className="field">
                  <label htmlFor="auth-password">
                    Password <i>*</i>
                  </label>
                  <div className="auth-password-wrap">
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={form.password}
                      autoComplete={setup ? 'new-password' : 'current-password'}
                      minLength={6}
                      maxLength={72}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </fieldset>
              {setup && input('setupKey', 'Setup key', 'password')}
              <button className="btn primary full" disabled={busy}>
                {busy ? <Spinner /> : setup ? 'Create administrator' : 'Sign in'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
