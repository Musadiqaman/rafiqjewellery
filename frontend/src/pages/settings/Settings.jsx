import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Store,
  FileText,
  Users,
  Save,
  Plus,
  Shield,
} from 'lucide-react';
import { can, roles, DEFAULT_AFFIDAVIT, AFFIDAVIT_FIELDS } from '../../lib/domain.js';
import { api, post, patch, setAccessToken, REVIEW_ONLY, dateLabel } from '../../lib/api';
import { Field, Notice, Spinner, Modal, SelectControl } from '../../components/ui';

const SCANNER_TOKEN_KEY = 'rafiqScannerPairingToken';
function readScannerToken() {
  try {
    return window.localStorage.getItem(SCANNER_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}
export function Settings({ user, shop }) {
  const client = useQueryClient(),
    admin = can(user.role, 'settings'),
    [tab, setTab] = useState(admin ? 'shop' : 'security'),
    [form, setForm] = useState({
      ...shop,
      affidavitTemplate: shop.affidavitTemplate || DEFAULT_AFFIDAVIT,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [add, setAdd] = useState(false),
    [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'cashier' }),
    [password, setPassword] = useState({ oldPassword: '', newPassword: '' }),
    [scannerToken, setScannerToken] = useState(readScannerToken);
  useEffect(
    () => setForm({ ...shop, affidavitTemplate: shop.affidavitTemplate || DEFAULT_AFFIDAVIT }),
    [shop],
  );
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api('/users'),
    enabled: admin && tab === 'team' && !REVIEW_ONLY,
  });
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => api('/audit'),
    enabled: admin && tab === 'activity' && !REVIEW_ONLY,
  });
  async function run(action, success) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await run(async () => {
      await patch('/settings', {
        shopName: form.shopName,
        address: form.address || '',
        phone: form.phone || '',
        receiptSize: form.receiptSize,
        scannerUrl: form.scannerUrl || '',
        affidavitTemplate: form.affidavitTemplate,
      });
      if (tab === 'shop') {
        try {
          if (scannerToken.trim()) {
            window.localStorage.setItem(SCANNER_TOKEN_KEY, scannerToken.trim());
          } else {
            window.localStorage.removeItem(SCANNER_TOKEN_KEY);
          }
        } catch {
          throw new Error('Could not save the scanner token in this browser. Check browser storage permissions.');
        }
      }
      if (Number(form.ratePaisa) !== shop.ratePaisa)
        await patch('/settings/rate', { ratePaisa: Number(form.ratePaisa) });
      await client.invalidateQueries({ queryKey: ['settings'] });
    }, 'Settings saved');
  }
  const field = (key, label, type = 'text') => (
    <Field label={label}>
      <input
        type={type}
        value={form[key] || ''}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </Field>
  );
  const tabs = admin
    ? [
        ['shop', 'Shop', Store],
        ['affidavit', 'Affidavit', FileText],
        ['team', 'Team', Users],
        ['security', 'Security', Shield],
        ['activity', 'Activity', FileText],
      ]
    : [['security', 'Security', Shield]];
  return (
    <div className="settings-page">
      <div className="settings-tabs">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            className={tab === id ? 'selected' : ''}
            onClick={() => {
              setTab(id);
              setError('');
              setMessage('');
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {error && <Notice error>{error}</Notice>}
      {message && (
        <div className="success-notice" role="status">
          {message}
        </div>
      )}
      {(tab === 'shop' || tab === 'affidavit') && (
        <form
          className="card settings-card"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {tab === 'shop' ? (
            <>
              <h2>Shop details</h2>
              <div className="settings-grid">
                {field('shopName', 'Shop name')}
                {field('phone', 'Shop phone')}
                {field('address', 'Shop address')}
                <Field label="Gold rate / tola · PKR">
                  <input
                    type="number"
                    min={1}
                    max={10000000}
                    step="0.01"
                    value={form.ratePaisa / 100}
                    onChange={(e) =>
                      setForm({ ...form, ratePaisa: Math.round(Number(e.target.value) * 100) })
                    }
                  />
                </Field>
                <Field label="Receipt size">
                  <SelectControl
                    value={form.receiptSize}
                    onChange={(value) => setForm({ ...form, receiptSize: value })}
                    ariaLabel="Receipt size"
                    options={[
                      { value: 'a4', label: 'A4' },
                      { value: '80mm', label: '80 mm thermal' },
                      { value: '58mm', label: '58 mm thermal' },
                    ]}
                  />
                </Field>
                {field('scannerUrl', 'Scanner bridge URL')}
                <Field label="Scanner pairing token">
                  <input
                    type="password"
                    value={scannerToken}
                    onChange={(e) => setScannerToken(e.target.value)}
                    autoComplete="new-password"
                    placeholder="Paste token shown by Scanner Bridge"
                  />
                </Field>
              </div>
            </>
          ) : (
            <>
              <h2>Receipt affidavit</h2>
              <p className="muted">
                Printed on new receipts. Saved receipts keep their original wording.
              </p>
              <textarea
                className="affidavit-editor"
                aria-label="Affidavit template"
                rows={8}
                maxLength={5000}
                value={form.affidavitTemplate}
                onChange={(e) => setForm({ ...form, affidavitTemplate: e.target.value })}
              />
              <div className="template-tags">
                {AFFIDAVIT_FIELDS.map((key) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() =>
                      setForm({
                        ...form,
                        affidavitTemplate: form.affidavitTemplate + ' {{' + key + '}}',
                      })
                    }
                  >
                    {'{{' + key + '}}'}
                  </button>
                ))}
              </div>
            </>
          )}
          <button className="btn primary" disabled={busy || REVIEW_ONLY}>
            {busy ? <Spinner /> : <Save size={16} />}Save settings
          </button>
        </form>
      )}
      {tab === 'team' && (
        <section className="card settings-card">
          <div className="section-heading">
            <h2>Team members</h2>
            <button
              className="btn primary small"
              onClick={() => setAdd(true)}
              disabled={REVIEW_ONLY}
            >
              <Plus size={16} />
              Add member
            </button>
          </div>
          {users.data?.map((u) => (
            <div className="team-row" key={u._id}>
              <div>
                <strong>{u.name}</strong>
                <small>{u.email}</small>
              </div>
              <SelectControl
                ariaLabel={'Role for ' + u.name}
                disabled={busy || u._id === user.id || u.isPrimaryAdmin}
                value={u.role}
                options={roles}
                onChange={(role) =>
                  run(async () => {
                    await patch('/users/' + u._id, { role, active: u.active });
                    client.invalidateQueries({ queryKey: ['users'] });
                  }, 'Access updated')
                }
              />
              <button
                className="btn secondary small"
                disabled={busy || u._id === user.id || u.isPrimaryAdmin}
                onClick={() =>
                  run(async () => {
                    await patch('/users/' + u._id, { role: u.role, active: !u.active });
                    client.invalidateQueries({ queryKey: ['users'] });
                  }, 'Access updated')
                }
              >
                {u.active ? 'Disable' : 'Enable'}
              </button>
            </div>
          ))}
          {!users.data && (
            <p className="muted">
              {REVIEW_ONLY ? 'Connect the backend to manage your team.' : 'Loading members…'}
            </p>
          )}
          <div className="role-summary">
            <span>
              <b>Admin</b> Full access
            </span>
            <span>
              <b>Manager</b> Purchases, rate, export, void
            </span>
            <span>
              <b>Cashier</b> View and create
            </span>
            <span>
              <b>Viewer</b> Read only
            </span>
          </div>
        </section>
      )}
      {tab === 'security' && (
        <form
          className="card settings-card password-settings-card"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const d = await post('/auth/password', password);
              setAccessToken(d.token, d.expiresAt);
              setPassword({ oldPassword: '', newPassword: '' });
            }, 'Password changed');
          }}
        >
          <h2>Change password</h2>
          <Field label="Current password">
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password.oldPassword}
              onChange={(e) => setPassword({ ...password, oldPassword: e.target.value })}
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              required
              minLength={6}
              maxLength={72}
              autoComplete="new-password"
              value={password.newPassword}
              onChange={(e) => setPassword({ ...password, newPassword: e.target.value })}
            />
          </Field>
          <button className="btn primary" disabled={busy || REVIEW_ONLY}>
            Update password
          </button>
        </form>
      )}
      {tab === 'activity' && (
        <section className="card settings-card">
          <h2>Recent activity</h2>
          {audit.data?.items.map((a) => (
            <div className="audit-row" key={a._id}>
              <strong>{a.action}</strong>
              <span>{a.actorName}</span>
              <small>{dateLabel(a.createdAt, true)}</small>
            </div>
          ))}
          {!audit.data && (
            <p className="muted">
              {REVIEW_ONLY ? 'Connect the backend to view activity.' : 'Loading…'}
            </p>
          )}
        </section>
      )}
      {add && (
        <Modal title="Add team member" onClose={() => setAdd(false)}>
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await post('/users', newUser);
                client.invalidateQueries({ queryKey: ['users'] });
                setAdd(false);
                setNewUser({ name: '', email: '', password: '', role: 'cashier' });
              }, 'Member added');
            }}
          >
            {['name', 'email', 'password'].map((key) => (
              <Field key={key} label={key[0].toUpperCase() + key.slice(1)} required>
                <input
                  required
                  type={key === 'name' ? 'text' : key}
                  minLength={key === 'password' ? 6 : 2}
                  value={newUser[key]}
                  autoComplete="off"
                  onChange={(e) => setNewUser({ ...newUser, [key]: e.target.value })}
                />
              </Field>
            ))}
            <Field label="Role">
              <SelectControl
                value={newUser.role}
                onChange={(role) => setNewUser({ ...newUser, role })}
                ariaLabel="New team member role"
                options={roles}
              />
            </Field>
            {error && <Notice error>{error}</Notice>}
            <button className="btn primary" disabled={busy}>
              Add member
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
