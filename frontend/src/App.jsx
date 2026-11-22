import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Home, Plus, Settings as SettingsIcon, LogOut } from 'lucide-react';
import { can, DEFAULT_AFFIDAVIT } from './lib/domain.js';
import { api, getAccessToken, clearAccessToken, REVIEW_ONLY } from './lib/api';
import { Auth } from './pages/auth/Auth.jsx';
import { Dashboard } from './pages/dashboard/Dashboard.jsx';
import { NewEntry } from './pages/new-entry/NewEntry.jsx';
import { Settings } from './pages/settings/Settings.jsx';
import { RecordView } from './pages/records/RecordView.jsx';
import { Modal, Spinner } from './components/ui';
const defaults = {
  shopName: 'Rafiq Jewellery',
  ratePaisa: 26000000,
  receiptSize: 'a4',
  scannerUrl: '',
  phone: '',
  address: '',
  affidavitTemplate: DEFAULT_AFFIDAVIT,
};
export default function App() {
  const client = useQueryClient(),
    [user, setUser] = useState(REVIEW_ONLY ? { name: 'Owner', role: 'admin' } : null),
    [loading, setLoading] = useState(!REVIEW_ONLY),
    [page, setPage] = useState('home'),
    [record, setRecord] = useState(null),
    [reauth, setReauth] = useState(false),
    [entryDirty, setEntryDirty] = useState(false),
    [entryInstance, setEntryInstance] = useState(0),
    [leaveConfirm, setLeaveConfirm] = useState(null);
  useEffect(() => {
    if (REVIEW_ONLY) return;
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    api('/auth/me')
      .then((d) => {
        setUser(d.user);
        setPage(d.user.role === 'cashier' ? 'entry' : 'home');
      })
      .catch(() => {
        clearAccessToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const expired = () => {
      clearAccessToken();
      setReauth(true);
    };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api('/settings'),
    enabled: !!user && !REVIEW_ONLY,
  });
  const shop = settings.data || defaults;
  const openRecord = (id, receipt = false) => {
    if (page === 'entry') {
      setEntryDirty(false);
      setEntryInstance((value) => value + 1);
    }
    setRecord({ id, receipt });
    setPage('record');
    window.scrollTo(0, 0);
  };
  const login = (u) => {
    setUser(u);
    setPage(u.role === 'cashier' ? 'entry' : 'home');
    setReauth(false);
    client.invalidateQueries();
  };
  const go = (requestedPage) => {
    const p = requestedPage === 'home' && !can(user.role, 'read') ? 'entry' : requestedPage;
    if (page === 'entry' && p !== 'entry' && entryDirty) {
      setLeaveConfirm({ type: 'page', page: p });
      return;
    }
    if (page === 'entry' && p !== 'entry') {
      setEntryDirty(false);
      setEntryInstance((value) => value + 1);
    }
    setPage(p);
    window.scrollTo(0, 0);
  };
  async function performLogout() {
    clearAccessToken();
    setUser(null);
    setPage('home');
    client.clear();
  }
  async function logout() {
    if (page === 'entry' && entryDirty) {
      setLeaveConfirm({ type: 'logout' });
      return;
    }
    if (page === 'entry') {
      setEntryDirty(false);
      setEntryInstance((value) => value + 1);
    }
    await performLogout();
  }
  async function confirmLeaveEntry() {
    const action = leaveConfirm;
    setLeaveConfirm(null);
    setEntryDirty(false);
    setEntryInstance((value) => value + 1);
    if (action?.type === 'logout') {
      await performLogout();
      return;
    }
    if (action?.type === 'page') {
      setPage(action.page);
      window.scrollTo(0, 0);
    }
  }
  if (loading)
    return (
      <div className="loading-screen">
        <Spinner />
      </div>
    );
  if (!user) return <Auth onLogin={login} />;
  return (
    <>
      <div className="workspace">
        <header className="topbar">
          <button className="brand" onClick={() => go(can(user.role, 'read') ? 'home' : 'entry')}>
            <span className="brand-icon brand-monogram" aria-label="Rafiq Jewellery">
              RJ
            </span>
            <strong>{shop.shopName}</strong>
          </button>
          <div className="top-actions">

            <span className="avatar" title={user.name}>
              {user.name?.[0]}
            </span>
            {!REVIEW_ONLY && (
              <button className="icon-btn" aria-label="Sign out" onClick={logout}>
                <LogOut size={18} />
              </button>
            )}
          </div>
        </header>
        <main className={'main ' + (page === 'entry' ? 'entry-main' : '')}>
          {page === 'home' && can(user.role, 'read') && <Dashboard user={user} onOpen={openRecord} />}
          {can(user.role, 'create') && (
            <div hidden={page !== 'entry'}>
              <NewEntry
                key={entryInstance}
                user={user}
                shop={shop}
                connected={!REVIEW_ONLY && !!settings.data}
                onOpen={openRecord}
                onDirtyChange={setEntryDirty}
              />
            </div>
          )}
          {page === 'settings' && <Settings user={user} shop={shop} />}
          {page === 'record' && record && (
            <RecordView
              id={record.id}
              initialReceipt={record.receipt}
              receiptSize={shop.receiptSize}
              deleteAllowed={can(user.role, 'delete')}
              receiptOnly={user.role === 'cashier'}
              onBack={() => go(can(user.role, 'read') ? 'home' : 'entry')}
            />
          )}
        </main>
        <nav className="bottom-nav" aria-label="Main navigation">
          <div className="nav-inner">
            {can(user.role, 'read') && (
              <button
                className={page === 'home' || page === 'record' ? 'active' : ''}
                onClick={() => go('home')}
              >
                <Home size={21} />
                <span>Home</span>
              </button>
            )}
            {can(user.role, 'create') && (
              <button
                className={'new-nav ' + (page === 'entry' ? 'active' : '')}
                onClick={() => go('entry')}
              >
                <span className="new-circle">
                  <Plus size={24} />
                </span>
                <span>New entry</span>
              </button>
            )}
            <button className={page === 'settings' ? 'active' : ''} onClick={() => go('settings')}>
              <SettingsIcon size={21} />
              <span>Settings</span>
            </button>
          </div>
        </nav>
      </div>
      {leaveConfirm && (
        <Modal title="Unsaved changes" onClose={() => setLeaveConfirm(null)}>
          <div className="modal-body leave-confirm">
            <p>
              Are you sure you want to leave this entry? Any unsaved information will be lost.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setLeaveConfirm(null)}
              >
                Stay on this page
              </button>
              <button type="button" className="btn primary" onClick={confirmLeaveEntry}>
                Leave entry
              </button>
            </div>
          </div>
        </Modal>
      )}
      {reauth && (
        <Modal title="Sign in to continue" onClose={() => setReauth(false)}>
          <Auth compact onLogin={login} />
        </Modal>
      )}
    </>
  );
}
