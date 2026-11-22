import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Trash2, ExternalLink } from 'lucide-react';
import { formatCnic } from '../../lib/domain.js';
import { api, apiBlob, post, money, dateLabel, mediaUrl, download } from '../../lib/api';
import { Modal, Notice, Spinner, Status, Field, SelectControl } from '../../components/ui';
const fields = (r) => [
  ['Seller', r.customer.name || '-'],
  ...(r.customer.cnic ? [['CNIC', formatCnic(r.customer.cnic)]] : []),
  ...(r.customer.phone ? [['Phone', r.customer.phone]] : []),
  ['Item', r.items?.length ? r.items.join(', ') : '—'],
  ['Carat', r.carat ? `${r.carat}K` : '—'],
  ['Weight', `${Number(r.grams || 0).toFixed(3)} g`],
  ['Rate / tola', money(r.ratePaisa, 2)],
];
const affidavitText = (value = '') => String(value).replace(/\s*\(\s*[\d.]+\s+tola\s*\)/gi, '');
const evidence = (r) => [
  ...(r.photoIds || []).map((id, i) => ({ id, label: 'Photo ' + (i + 1) })),
  ...(r.signatureId ? [{ id: r.signatureId, label: 'Signature' }] : []),
  ...(r.thumbId ? [{ id: r.thumbId, label: 'Thumb image · ' + r.thumbSource }] : []),
];

function AuthImage({ id, alt, ...props }) {
  const [src, setSrc] = useState('');
  const [status, setStatus] = useState('loading');
  const imageRef = useRef(null);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setSrc('');
    setStatus('loading');
    apiBlob(mediaUrl(id))
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setSrc(objectUrl);
          setStatus('loaded');
        } else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) {
          setStatus('error');
          imageRef.current?.dispatchEvent(new Event('error'));
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return (
    <img
      {...props}
      ref={imageRef}
      src={src || undefined}
      alt={alt}
      data-auth-media="true"
      data-media-state={status}
    />
  );
}

function Receipt({ r, size }) {
  return (
    <article className={'receipt-paper ' + size} data-paper-size={size} id="print-receipt">
      <header>
        <h1>{r.shopSnapshot?.name || 'Rafiq Jewellery'}</h1>
        {r.shopSnapshot?.address && <p>{r.shopSnapshot.address}</p>}
        {r.shopSnapshot?.phone && <p>{r.shopSnapshot.phone}</p>}
        <h2>GOLD PURCHASE RECEIPT</h2>
        {r.voided && <b>VOIDED</b>}
      </header>
      <div className="receipt-meta">
        <strong>{r.reference}</strong>
        <span>{dateLabel(r.purchasedAt, true)}</span>
      </div>
      <dl>
        {fields(r).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="receipt-payable">
        <span>Total paid</span>
        <strong>{money(r.totalPaisa, 2)}</strong>
      </div>
      {size === 'a4' && (
        <>
          <h3>Seller affidavit</h3>
          <p className="receipt-declaration">{affidavitText(r.declarationText)}</p>
          <div className="receipt-evidence">
            {evidence(r)
              .filter((p) => p.id === r.signatureId || p.id === r.thumbId)
              .map((p) => (
                <div key={p.id}>
                  <AuthImage id={p.id} alt={p.label} />
                  <span>{p.label}</span>
                </div>
              ))}
          </div>
          <footer>Recorded by {r.createdByName}</footer>
        </>
      )}
      {r.voided && <p>Void reason: {r.voidReason}</p>}
    </article>
  );
}
async function receiptImage(r, size = 'a4') {
  await document.fonts.ready;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = '400 20px Inter';
  const lines = [];
  const wrap = (value, bold = false) => {
    measure.font = `${bold ? '600' : '400'} 20px Inter`;
    for (const paragraph of String(value).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? line + ' ' + word : word;
        if (measure.measureText(next).width > 930 && line) {
          lines.push({ text: line, bold });
          line = word;
        } else line = next;
      }
      lines.push({ text: line, bold });
    }
  };
  wrap(r.shopSnapshot?.name || 'Rafiq Jewellery', true);
  if (r.shopSnapshot?.address) wrap(r.shopSnapshot.address);
  if (r.shopSnapshot?.phone) wrap(r.shopSnapshot.phone);
  wrap('GOLD PURCHASE RECEIPT', true);
  wrap(r.reference + ' · ' + dateLabel(r.purchasedAt, true));
  wrap('');
  for (const [k, v] of fields(r)) wrap(k + ': ' + v);
  wrap('Total paid: ' + money(r.totalPaisa, 2), true);
  const images = [];
  const objectUrls = [];
  try {
    if (size === 'a4') {
      wrap('');
      wrap('Seller affidavit', true);
      wrap(affidavitText(r.declarationText));
    }
    for (const p of (size === 'a4' ? evidence(r) : []).filter((x) => x.id === r.signatureId || x.id === r.thumbId)) {
      const objectUrl = URL.createObjectURL(await apiBlob(mediaUrl(p.id)));
      objectUrls.push(objectUrl);
      const img = new window.Image();
      img.src = objectUrl;
      await img.decode();
      images.push({ img, label: p.label });
    }
    if (r.voided) wrap('VOIDED: ' + r.voidReason, true);
    if (size === 'a4') wrap('Recorded by ' + r.createdByName);
    const canvas = document.createElement('canvas');
    canvas.width = 1100;
    canvas.height = 160 + lines.length * 32 + images.length * 220;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#15202b';
    let y = 80;
    for (const line of lines) {
      ctx.font = `${line.bold ? '600' : '400'} 20px Inter`;
      ctx.fillText(line.text, 80, y);
      y += 32;
    }
    for (const { img, label } of images) {
      y += 20;
      ctx.font = '500 18px Inter';
      ctx.fillText(label, 80, y);
      y += 15;
      const scale = Math.min(450 / img.width, 150 / img.height);
      ctx.drawImage(img, 80, y, img.width * scale, img.height * scale);
      y += 180;
    }
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(Error('Unable to create image'))), 'image/png'),
    );
    download(blob, r.reference + '.png');
  } finally {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}
export function RecordView({
  id,
  onBack,
  deleteAllowed,
  initialReceipt = false,
  receiptSize = 'a4',
  receiptOnly = false,
}) {
  const client = useQueryClient(),
    q = useQuery({ queryKey: ['record', id], queryFn: () => api('/records/' + id) }),
    r = q.data;
  const [receipt, setReceipt] = useState(initialReceipt),
    [size, setSize] = useState(receiptSize),
    [deleteOpen, setDeleteOpen] = useState(false),
    [deleteReason, setDeleteReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [image, setImage] = useState(null),
    [imageBusy, setImageBusy] = useState(false);
  useEffect(() => {
    document.body.classList.toggle('receipt-open', receipt);
    document.body.dataset.receiptSize = size;
    document.documentElement.dataset.receiptSize = size;
    return () => {
      document.body.classList.remove('receipt-open');
      delete document.body.dataset.receiptSize;
      delete document.documentElement.dataset.receiptSize;
    };
  }, [receipt, size]);
  async function deleteRecord() {
    setBusy(true);
    setError('');
    try {
      await post('/records/' + id + '/delete', { reason: deleteReason });
      await Promise.all(
        ['record', 'records'].map((k) => client.invalidateQueries({ queryKey: [k] })),
      );
      setDeleteOpen(false);
      onBack();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (q.isPending)
    return (
      <div className="loading">
        <Spinner />
      </div>
    );
  if (q.isError) return <Notice error>{q.error.message}</Notice>;
  return (
    <>
      <div className="page-heading">
        <div className="button-row">
          <button className="icon-btn" aria-label={receiptOnly ? "Back to new entry" : "Back to dashboard"} onClick={onBack}>
            <ArrowLeft size={21} />
          </button>
          <h1>{r.reference}</h1>
        </div>
        <button className="btn primary" onClick={() => setReceipt(true)}>
          <Printer size={17} />
          Receipt
        </button>
      </div>
      {!receiptOnly ? (
        <div className="record-layout">
          <section className="card detail-card">
            <div className="section-heading">
              <h2>Purchase details</h2>
              <Status r={r} />
            </div>
            <dl className="detail-list">
              {[
                ['Date', dateLabel(r.purchasedAt, true)],
                ...fields(r),
                ['Recorded by', r.createdByName],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="detail-total">
              <span>Total paid</span>
              <strong>{money(r.totalPaisa, 2)}</strong>
            </div>
            {r.voided && <Notice>Voided: {r.voidReason}</Notice>}
            {deleteAllowed && (
              <button className="text-btn danger-text" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={15} />
                Delete purchase
              </button>
            )}
          </section>
          <section className="card detail-card">
            <h2>Photos & signature</h2>
            {evidence(r).length ? (
              <div className="evidence-gallery">
                {evidence(r).map((p) => (
                  <button key={p.id} onClick={() => setImage(p)}>
                    <AuthImage id={p.id} alt={p.label} />
                    <span>
                      {p.label}
                      <ExternalLink size={13} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No photos, signature or thumb image attached.</p>
            )}
          </section>
        </div>
      ) : (
        <section className="card detail-card cashier-receipt-note">
          <p className="muted">Receipt is ready. Print it or download a copy before starting the next entry.</p>
        </section>
      )}
      {receipt && (
        <Modal title="Purchase receipt" wide onClose={() => setReceipt(false)}>
          <div className="receipt-toolbar">
            <SelectControl
              ariaLabel="Receipt paper size"
              value={size}
              onChange={setSize}
              options={[
                { value: 'a4', label: 'A4' },
                { value: '80mm', label: '80 mm' },
                { value: '58mm', label: '58 mm' },
              ]}
            />
            <button
              className="btn secondary small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await receiptImage(r, size);
                } catch {
                  setError('Image export failed. Please retry.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Download size={15} />
              Download PNG
            </button>
            <button
              className="btn primary small"
              onClick={async () => {
                const images = [...document.querySelectorAll('#print-receipt img[data-auth-media]')];
                await Promise.all(
                  images.map((img) =>
                    img.dataset.mediaState === 'error' || (img.complete && img.naturalWidth)
                      ? Promise.resolve()
                      : new Promise((resolve) => {
                          img.addEventListener('load', resolve, { once: true });
                          img.addEventListener('error', resolve, { once: true });
                        }),
                  ),
                );
                window.print();
              }}
            >
              <Printer size={15} />
              Print / PDF
            </button>
          </div>
          {error && <Notice error>{error}</Notice>}
          <div className="receipt-surround">
            <Receipt r={r} size={size} />
          </div>
          <style>{`@media print {
            @page {
              ${
                size === 'a4'
                  ? 'size: A4 portrait; margin: 12mm;'
                  : size === '58mm'
                    ? 'size: 58mm auto; margin: 0;'
                    : 'size: 80mm auto; margin: 0;'
              }
            }
          }`}</style>
        </Modal>
      )}
      {deleteOpen && (
        <Modal title="Delete purchase" onClose={() => setDeleteOpen(false)}>
          <div className="modal-body">
            <p className="muted">
              This purchase will be removed from active records and dashboard totals.
              Its details and deletion reason will be retained in the audit history.
            </p>
            <Field label="Reason for deletion" required>
              <textarea
                rows={3}
                minLength={10}
                maxLength={500}
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Enter at least 10 characters"
              />
            </Field>
            {error && <Notice error>{error}</Notice>}
            <div className="button-row">
              <button className="btn secondary" onClick={() => setDeleteOpen(false)}>
                Cancel
              </button>
              <button
                className="btn danger"
                disabled={busy || deleteReason.trim().length < 10}
                onClick={deleteRecord}
              >
                <Trash2 size={15} />
                Delete purchase
              </button>
            </div>
          </div>
        </Modal>
      )}
      {image && (
        <Modal title={image.label} wide onClose={() => setImage(null)}>
          <div className="modal-body">
            <AuthImage className="original-image" id={image.id} alt={image.label} />
            <button
              type="button"
              className="btn secondary"
              disabled={imageBusy}
              onClick={async () => {
                const tab = window.open('about:blank', '_blank');
                setImageBusy(true);
                setError('');
                try {
                  const blob = await apiBlob(mediaUrl(image.id));
                  const url = URL.createObjectURL(blob);
                  if (tab) tab.location.href = url;
                  else {
                    const extension = blob.type.split('/')[1]?.split(';')[0] || 'img';
                    download(blob, `${r.reference}-${image.label}.${extension}`);
                  }
                  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
                } catch (openError) {
                  tab?.close();
                  setError(openError.message);
                } finally {
                  setImageBusy(false);
                }
              }}
            >
              {imageBusy ? <Spinner /> : <ExternalLink size={15} />}
              Open original image
            </button>
            {error && <Notice error>{error}</Notice>}
          </div>
        </Modal>
      )}
    </>
  );
}
