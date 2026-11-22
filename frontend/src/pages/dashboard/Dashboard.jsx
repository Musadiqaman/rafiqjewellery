import { useState, useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Download, Eye, EyeOff } from 'lucide-react';
import { can, formatCnic, GRAMS_PER_TOLA } from '../../lib/domain.js';
import { api, apiBlob, money, dateLabel, dateKey, download, REVIEW_ONLY } from '../../lib/api';
import { Empty, Notice, Spinner, Modal, Field, DatePicker } from '../../components/ui';

const STATS_VISIBILITY_KEY = 'rafiq-jewellery-stats-visibility';
const DEFAULT_STATS_VISIBILITY = { totalPaid: false, goldPurchased: false, purchases: false };
function readStatsVisibility() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STATS_VISIBILITY_KEY) || 'null');
    return {
      totalPaid: saved?.totalPaid === true,
      goldPurchased: saved?.goldPurchased === true,
      purchases: saved?.purchases === true,
    };
  } catch {
    return { ...DEFAULT_STATS_VISIBILITY };
  }
}

export function Dashboard({ user, onOpen }) {
  const [visibleStats, setVisibleStats] = useState(readStatsVisibility),
    [period, setPeriod] = useState('today'),
    [from, setFrom] = useState(dateKey()),
    [to, setTo] = useState(dateKey()),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [customOpen, setCustomOpen] = useState(false),
    [draftFrom, setDraftFrom] = useState(dateKey()),
    [draftTo, setDraftTo] = useState(dateKey()),
    [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState(''),
    parent = useRef(null),
    sentinel = useRef(null);
  useEffect(() => {
    try {
      window.localStorage.setItem(STATS_VISIBILITY_KEY, JSON.stringify(visibleStats));
    } catch {
      // Keep the dashboard usable if browser storage is unavailable.
    }
  }, [visibleStats]);
  const toggleStat = (key) =>
    setVisibleStats((current) => ({ ...current, [key]: !current[key] }));
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({ q: query });
  if (period === 'today') {
    params.set('from', dateKey());
    params.set('to', dateKey());
  } else if (period === 'custom') {
    if (from) params.set('from', from);
    if (to) params.set('to', to);
  }
  const key = params.toString(),
    valid = period !== 'custom' || (!!from && !!to && from <= to),
    enabled = !REVIEW_ONLY && valid;
  const records = useInfiniteQuery({
    queryKey: ['records', key],
    queryFn: ({ pageParam }) =>
      pageParam
        ? api('/records?' + key + '&cursor=' + encodeURIComponent(pageParam))
        : api('/dashboard?' + key),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  });
  const rows = records.data?.pages.flatMap((p) => p.items) || [],
    virtual = useVirtualizer({
      count: rows.length,
      getScrollElement: () => parent.current,
      estimateSize: () => 66,
      overscan: 8,
    });
  useEffect(() => {
    parent.current?.scrollTo(0, 0);
  }, [key]);
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !records.hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !records.isFetchingNextPage) records.fetchNextPage();
      },
      { root: parent.current, rootMargin: '180px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [records.hasNextPage, records.isFetchingNextPage, rows.length]);
  const d = records.data?.pages[0]?.stats;
  return (
    <div className="dashboard">
      <div className="dashboard-filters">
        <div className="segmented" aria-label="Date range">
          {[
            ['today', 'Today'],
            ['all', 'All dates'],
            ['custom', 'Custom'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={period === value ? 'selected' : ''}
              aria-pressed={period === value}
              onClick={() => {
                if (value === 'custom') {
                  setDraftFrom(from);
                  setDraftTo(to);
                  setCustomOpen(true);
                } else {
                  setPeriod(value);
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="search-box">
          <Search size={17} />
          <input
            aria-label="Search purchases"
            placeholder="Search name, CNIC, phone, receipt or weight (e.g. 11.664g or 1 tola)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button aria-label="Clear search" onClick={() => setSearch('')}>
              ×
            </button>
          )}
        </div>
      </div>
      {!valid && <Notice error>Select a valid date range.</Notice>}
      <section className="stats-grid" aria-label="Purchase statistics">
        <div className="stat stat-dark">
          <div className="stat-heading">
            <span>Total paid</span>
            <button
              type="button"
              className="stat-visibility"
              aria-label={visibleStats.totalPaid ? 'Hide total paid' : 'Show total paid'}
              aria-pressed={visibleStats.totalPaid}
              title={visibleStats.totalPaid ? 'Hide total paid' : 'Show total paid'}
              onClick={() => toggleStat('totalPaid')}
            >
              {visibleStats.totalPaid ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <strong>{visibleStats.totalPaid ? (d ? money(d.amount) : '—') : '••••••'}</strong>
          <small>
            {visibleStats.totalPaid
              ? period === 'today'
                ? "Today's purchases"
                : period === 'all'
                  ? 'All dates'
                  : 'Selected dates'
              : 'Hidden'}
          </small>
        </div>
        <div className="stat">
          <div className="stat-heading">
            <span>Gold purchased</span>
            <button
              type="button"
              className="stat-visibility"
              aria-label={visibleStats.goldPurchased ? 'Hide gold purchased' : 'Show gold purchased'}
              aria-pressed={visibleStats.goldPurchased}
              title={visibleStats.goldPurchased ? 'Hide gold purchased' : 'Show gold purchased'}
              onClick={() => toggleStat('goldPurchased')}
            >
              {visibleStats.goldPurchased ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <strong>
            {visibleStats.goldPurchased && d
              ? d.grams.toLocaleString('en-PK', { maximumFractionDigits: 3 })
              : visibleStats.goldPurchased
                ? '—'
                : '••••'}
            {visibleStats.goldPurchased && <em> g</em>}
          </strong>
          <small>
            {visibleStats.goldPurchased && d
              ? Number(d.tola || 0).toFixed(4) + ' tola'
              : visibleStats.goldPurchased
                ? 'Weight'
                : 'Hidden'}
          </small>
        </div>
        <div className="stat">
          <div className="stat-heading">
            <span>Purchases</span>
            <button
              type="button"
              className="stat-visibility"
              aria-label={visibleStats.purchases ? 'Hide purchases' : 'Show purchases'}
              aria-pressed={visibleStats.purchases}
              title={visibleStats.purchases ? 'Hide purchases' : 'Show purchases'}
              onClick={() => toggleStat('purchases')}
            >
              {visibleStats.purchases ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <strong>{visibleStats.purchases ? (d ? d.count.toLocaleString() : '—') : '••••'}</strong>
          <small>{visibleStats.purchases ? 'Total records' : 'Hidden'}</small>
        </div>
      </section>
      <section className="card ledger-card">
        <div className="ledger-heading">
          <h2>Purchase records</h2>
          <div className="button-row">
            {can(user.role, 'export') && (
              <button
                type="button"
                className="btn secondary small"
                disabled={!enabled || exporting}
                onClick={async () => {
                  setExporting(true);
                  setExportError('');
                  try {
                    download(await apiBlob('/records/export.csv?' + key), 'gold-purchases.csv');
                  } catch (error) {
                    setExportError(error.message);
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                {exporting ? <Spinner /> : <Download size={15} />}
                <span>{exporting ? 'Exporting' : 'Export'}</span>
              </button>
            )}
          </div>
        </div>
        {records.isError ? <Notice error>{records.error.message}</Notice> : null}
        {exportError ? <Notice error>{exportError}</Notice> : null}
        <div className="ledger-columns">
          <span>Seller / CNIC</span>
          <span>Receipt</span>
          <span>Date & time</span>
          <span>Weight</span>
          <span>Amount</span>
        </div>
        <div className="ledger-scroll" ref={parent}>
          {rows.length ? (
            <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
              {virtual.getVirtualItems().map((v) => {
                const r = rows[v.index];
                const grams = Number(r.grams) || 0;
                const tola = Number.isFinite(Number(r.tola)) ? Number(r.tola) : grams / GRAMS_PER_TOLA;
                return (
                  <button
                    className="ledger-row"
                    key={r._id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: v.size,
                      transform: `translateY(${v.start}px)`,
                    }}
                    onClick={() => onOpen(r._id)}
                  >
                    <span className="seller">
                      <span className="seller-avatar">
                        {(r.customer.name || '-')[0].toUpperCase()}
                      </span>
                      <span>
                        <b>{r.customer.name || '-'}</b>
                        <small>{r.customer.cnic ? formatCnic(r.customer.cnic) : 'CNIC not provided'}</small>
                      </span>
                    </span>
                    <span className="row-reference">{r.reference}</span>
                    <span className="row-date">{dateLabel(r.purchasedAt, true)}</span>
                    <span className="row-weight">
                      {tola.toFixed(4)} tola <small>· {grams.toFixed(3)} g</small>
                    </span>
                    <strong className="row-amount">{money(r.totalPaisa, 2)}</strong>
                  </button>
                );
              })}
            </div>
          ) : records.isFetching ? (
            <div className="loading">
              <Spinner />
            </div>
          ) : (
            <Empty
              title={
                REVIEW_ONLY
                  ? 'API not connected'
                  : query
                    ? 'No matching purchases'
                    : 'No purchases yet'
              }
              text={
                REVIEW_ONLY
                  ? 'Run the backend to load your records.'
                  : query
                    ? 'Try another name, CNIC, phone or receipt.'
                    : ''
              }
            />
          )}
          <div ref={sentinel} />
          {records.hasNextPage && (
            <button
              className="load-more"
              disabled={records.isFetchingNextPage}
              onClick={() => records.fetchNextPage()}
            >
              {records.isFetchingNextPage ? <Spinner /> : 'Load more'}
            </button>
          )}
        </div>
        <div className="ledger-footer">
          <span>
            {rows.length ? `${rows.length} records loaded` : 'Records appear here after saving'}
          </span>
        </div>
      </section>
      {customOpen && (
        <Modal title="Custom date range" onClose={() => setCustomOpen(false)}>
          <div className="modal-body date-picker-modal">
            <p className="muted">Choose the start and end dates for purchase records.</p>
            <div className="date-picker-fields">
              <Field label="From date">
                <DatePicker
                  ariaLabel="From date"
                  value={draftFrom}
                  max={draftTo || undefined}
                  onChange={setDraftFrom}
                />
              </Field>
              <Field label="To date">
                <DatePicker
                  ariaLabel="To date"
                  value={draftTo}
                  min={draftFrom || undefined}
                  onChange={setDraftTo}
                />
              </Field>
            </div>
            {draftFrom && draftTo && draftFrom > draftTo && (
              <Notice error>The end date must be on or after the start date.</Notice>
            )}
            <div className="button-row date-picker-actions">
              <button type="button" className="btn secondary" onClick={() => setCustomOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!draftFrom || !draftTo || draftFrom > draftTo}
                onClick={() => {
                  setFrom(draftFrom);
                  setTo(draftTo);
                  setPeriod('custom');
                  setCustomOpen(false);
                }}
              >
                Apply dates
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
