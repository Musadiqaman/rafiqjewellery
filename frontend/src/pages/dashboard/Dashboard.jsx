import { useState, useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Download, ArrowUpRight, ReceiptText, Scale } from 'lucide-react';
import { can, formatCnic, GRAMS_PER_TOLA } from '../../lib/domain.js';
import { api, apiBlob, money, dateLabel, dateKey, download, REVIEW_ONLY } from '../../lib/api';
import { Empty, Notice, Spinner, Modal, Field, DatePicker } from '../../components/ui';
export function Dashboard({ user, onOpen }) {
  const [period, setPeriod] = useState('today'),
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
            placeholder="Search name, CNIC, phone or receipt"
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
      <section className="stats-grid">
        <div className="stat stat-dark">
          <div>
            <span>Total paid</span>
            <ArrowUpRight size={19} />
          </div>
          <strong>{d ? money(d.amount) : '—'}</strong>
          <small>
            {period === 'today'
              ? "Today's purchases"
              : period === 'all'
                ? 'All dates'
                : 'Selected dates'}
          </small>
        </div>
        <div className="stat">
          <div>
            <span>Gold purchased</span>
            <Scale size={19} />
          </div>
          <strong>
            {d ? d.grams.toLocaleString('en-PK', { maximumFractionDigits: 3 }) : '—'}
            <em> g</em>
          </strong>
          <small>{d ? Number(d.tola || 0).toFixed(4) + ' tola' : 'Weight'}</small>
        </div>
        <div className="stat">
          <div>
            <span>Purchases</span>
            <ReceiptText size={19} />
          </div>
          <strong>{d ? d.count.toLocaleString() : '—'}</strong>
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
