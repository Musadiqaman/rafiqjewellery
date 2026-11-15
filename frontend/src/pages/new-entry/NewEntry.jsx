import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Camera as CameraIcon,
  Upload,
  PenLine,
  Fingerprint,
  Check,
  Printer,
  X,
  Save,
  Plus,
  ScanLine,
} from 'lucide-react';
import {
  calculate,
  can,
  cnicDigits,
  formatCnicInput,
  entrySchema,
  weightFromGrams,
} from '../../lib/domain.js';
import { post, upload, money } from '../../lib/api';
import { Field, Notice, Spinner, Modal, SelectControl } from '../../components/ui';
import { SignaturePad } from '../../components/SignaturePad';
import { Camera } from '../../components/Camera';
const initialWeight = () => ({ mode: 'traditional', tola: '', masha: '', ratti: '', grams: '' });
export function NewEntry({ user, shop, connected, onOpen, onDirtyChange }) {
  const client = useQueryClient(),
    [weight, setWeight] = useState(initialWeight),
    [rate, setRate] = useState(String(shop.ratePaisa / 100)),
    [customer, setCustomer] = useState({ cnic: '', name: '', phone: '' }),
    [item, setItem] = useState(''),
    [signature, setSignature] = useState(''),
    [thumb, setThumb] = useState(null),
    [photos, setPhotos] = useState([]),
    [capture, setCapture] = useState(null),
    [tab, setTab] = useState('thumb'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(null),
    [scanner, setScanner] = useState(false),
    [token, setToken] = useState(() => {
      try {
        return window.localStorage.getItem('rafiqScannerPairingToken') || '';
      } catch {
        return '';
      }
    }),
    [scannerPreview, setScannerPreview] = useState(null);
  const inputPhoto = useRef(null),
    inputThumb = useRef(null),
    cnic = useRef(null),
    key = useRef(crypto.randomUUID()),
    cache = useRef(new Map()),
    resources = useRef(new Set());
  useEffect(() => {
    setRate(String(shop.ratePaisa / 100));
  }, [shop.ratePaisa]);
  useEffect(
    () => () => {
      resources.current.forEach(URL.revokeObjectURL);
    },
    [],
  );
  const numeric = {
    mode: weight.mode,
    tola: Number(weight.tola) || 0,
    masha: Number(weight.masha) || 0,
    ratti: Number(weight.ratti) || 0,
    grams: Number(weight.grams) || 0,
  };
  const sums = calculate(numeric, Math.round((Number(rate) || 0) * 100));
  const hasWeight = [weight.tola, weight.masha, weight.ratti, weight.grams].some(
    (value) => value !== '' && Number(value) > 0,
  );
  const isDirty =
    hasWeight ||
    Object.values(customer).some((value) => String(value).trim()) ||
    Boolean(signature || thumb || photos.length || item) ||
    rate !== String(shop.ratePaisa / 100);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    if (isDirty) setSaved(null);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeLeaving = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [isDirty]);

  function unit(name, value) {
    setSaved(null);
    setWeight((w) =>
      name === 'grams'
        ? { ...weightFromGrams(Number(value) || 0), grams: value }
        : { ...w, mode: 'traditional', [name]: value },
    );
  }
  function makeAsset(file, source = 'camera') {
    if (file.size > 3 * 1024 * 1024) throw Error('Each image must be 3 MB or smaller');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
      throw Error('Use JPG, PNG or WebP');
    const url = URL.createObjectURL(file);
    resources.current.add(url);
    return { file, url, source };
  }
  function addPhoto(file) {
    try {
      if (photos.length >= 8) throw Error('Maximum 8 photos');
      setPhotos((p) => [...p, makeAsset(file)]);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  function addThumb(file, source = 'camera') {
    try {
      setThumb(makeAsset(file, source));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  const uploadOnce = async (asset, kind, source) => {
    const found = cache.current.get(asset);
    if (found) return found;
    const data = await upload(asset, kind, source);
    cache.current.set(asset, data.id);
    return data.id;
  };
  async function save() {
    setError('');
    setSaved(null);
    const draft = {
      weight: numeric,
      ratePaisa: Math.round(Number(rate) * 100),
      items: item ? [item] : [],
      customer: { ...customer, cnic: cnicDigits(customer.cnic) },
      photoIds: [],
      signatureId: signature ? '0'.repeat(24) : null,
      thumbId: thumb ? '1'.repeat(24) : null,
      thumbSource: thumb?.source || null,
      idempotencyKey: key.current,
    };
    const checked = entrySchema.safeParse(draft);
    if (!checked.success) {
      setError(checked.error.issues[0].message);
      if (checked.error.issues[0].path.includes('cnic')) cnic.current?.focus();
      return;
    }
    if (!connected) {
      setError('Connect the backend before saving.');
      return;
    }
    setBusy(true);
    try {
      const sigKey = 'signature:' + signature;
      let signatureId = null;
      if (signature) {
        signatureId = cache.current.get(sigKey);
        if (!signatureId) {
          const blob = await (await fetch(signature)).blob();
          signatureId = await uploadOnce(blob, 'signature', 'signature');
          cache.current.set(sigKey, signatureId);
        }
      }
      const [photoIds, thumbId] = await Promise.all([
        Promise.all(photos.map((p) => uploadOnce(p.file, 'photo', 'upload'))),
        thumb ? uploadOnce(thumb.file, 'thumb', thumb.source) : Promise.resolve(null),
      ]);
      const result = await post('/records', { ...checked.data, photoIds, signatureId, thumbId });
      setSaved(result);
      onDirtyChange?.(false);
      setWeight(initialWeight());
      setCustomer({ cnic: '', name: '', phone: '' });
      setItem('');
      setRate(String(shop.ratePaisa / 100));
      setSignature('');
      setThumb(null);
      setTab('thumb');
      setScannerPreview(null);
      setPhotos([]);
      cache.current.clear();
      resources.current.forEach(URL.revokeObjectURL);
      resources.current.clear();
      key.current = crypto.randomUUID();
      client.invalidateQueries({ queryKey: ['records'] });
      cnic.current?.focus();
    } catch (e) {
      if (e.resetSubmission) {
        key.current = crypto.randomUUID();
        cache.current.clear();
      }
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function openScanner() {
    setError('');
    try {
      setToken(window.localStorage.getItem('rafiqScannerPairingToken') || '');
    } catch {
      setToken('');
    }
    setScannerPreview(thumb?.source === 'scanner' ? thumb : null);
    setScanner(true);
  }

  async function scan() {
    setBusy(true);
    setError('');
    try {
      if (!shop.scannerUrl) throw Error('Add your scanner bridge in Settings.');
      if (!token.trim()) throw Error('Enter the scanner pairing token.');

      const response = await fetch(shop.scannerUrl.replace(/\/+$/, '') + '/capture', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token.trim() },
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        const detail = await response.text();
        let message = `Scanner capture failed (HTTP ${response.status})`;
        if (detail) {
          try {
            const data = JSON.parse(detail);
            message = data.error || data.message || data.detail || message;
          } catch {
            message = detail;
          }
        }
        throw Error(message);
      }

      const blob = await response.blob();
      if (!blob.size) throw Error('Scanner returned an empty image. Please capture again.');
      if (!blob.type.startsWith('image/')) {
        throw Error('Scanner response was not an image. Check the scanner bridge.');
      }

      const asset = makeAsset(
        new File([blob], 'thumb.png', { type: blob.type || 'image/png' }),
        'scanner',
      );
      if (thumb?.url) {
        URL.revokeObjectURL(thumb.url);
        resources.current.delete(thumb.url);
      }
      setThumb(asset);
      setScannerPreview(asset);
      setError('');
      // Keep the modal open so the user can inspect the image and choose Recapture or Use fingerprint.
    } catch (e) {
      setError(e.message || 'Scanner capture failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="entry-page">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="entry-card card"
      >
        <fieldset disabled={busy} className="entry-fields">
          <div className="entry-top">
            <div className="entry-top-fields">
              <Field label="Rate / tola · PKR">
                <input
                  aria-label="Rate per tola"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="10000000"
                  step="0.01"
                  value={rate}
                  readOnly={!can(user.role, 'rate')}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setRate(e.target.value)}
                />
              </Field>
              <Field label="Item (optional)">
                <SelectControl
                  value={item}
                  onChange={setItem}
                  placeholder="Select item"
                  ariaLabel="Gold item"
                  options={[
                    { value: 'Gold ornaments', label: 'Gold ornaments' },
                    { value: 'Ring', label: 'Ring' },
                    { value: 'Chain', label: 'Chain' },
                    { value: 'Bangles', label: 'Bangles' },
                    { value: 'Earrings', label: 'Earrings' },
                    { value: 'Necklace', label: 'Necklace' },
                    { value: 'Gold bar', label: 'Gold bar' },
                    { value: 'Other gold', label: 'Other gold' },
                  ]}
                />
              </Field>
            </div>
          </div>
          <div className="weight-block">
            <div className="weight-grid">
              {[
                ['tola', 'Tola'],
                ['masha', 'Masha'],
                ['ratti', 'Ratti'],
                ['grams', 'Grams'],
              ].map(([name, label]) => (
                <Field key={name} label={label}>
                  <input
                    aria-label={label}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max={name === 'masha' ? 11.999 : name === 'ratti' ? 7.999 : 100000}
                    step="any"
                    placeholder="0"
                    value={
                      name === 'grams' && weight.mode === 'traditional'
                        ? sums.grams
                          ? sums.grams.toFixed(3)
                          : ''
                        : weight[name]
                    }
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => unit(name, e.target.value)}
                  />
                </Field>
              ))}
            </div>
          </div>
          <div className="entry-details">
            <Field label="CNIC (optional)">
              <input
                ref={cnic}
                aria-label="CNIC"
                inputMode="numeric"
                autoComplete="off"
                maxLength={15}
                placeholder="00000-0000000-0"
                value={customer.cnic}
                onChange={(e) =>
                  setCustomer({ ...customer, cnic: formatCnicInput(e.target.value) })
                }
              />
            </Field>
            <Field label="Name (optional)">
              <input
                autoComplete="off"
                maxLength={100}
                placeholder="Customer name"
                value={customer.name}
                onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
              />
            </Field>
            <Field label="Phone (optional)">
              <input
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={20}
                placeholder="03xx xxxxxxx"
                value={customer.phone}
                onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
              />
            </Field>
          </div>
          <div className="capture-grid">
            <section className="proof-panel">
              <div className="proof-heading">
                <div className="proof-tabs">
                  <button
                    type="button"
                    className={tab === 'signature' ? 'selected' : ''}
                    onClick={() => setTab('signature')}
                  >
                    <PenLine size={14} />
                    Signature{signature && <Check size={13} />}
                  </button>
                  <button
                    type="button"
                    className={tab === 'thumb' ? 'selected' : ''}
                    onClick={() => setTab('thumb')}
                  >
                    <Fingerprint size={15} />
                    Thumb{thumb && <Check size={13} />}
                  </button>
                </div>
              </div>
              {tab === 'signature' ? (
                <SignaturePad value={signature} onChange={setSignature} />
              ) : (
                <div className="thumb-panel">
                  {thumb ? (
                    <>
                      <img src={thumb.url} alt="Captured thumb" />
                      <span className="captured">
                        <Check size={14} />
                        Captured
                      </span>
                      <button
                        className="icon-btn"
                        type="button"
                        aria-label="Remove thumb"
                        onClick={() => {
                          setThumb(null);
                          setScannerPreview(null);
                        }}
                      >
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <Fingerprint className="thumb-placeholder" size={32} />
                  )}
                  <div className="thumb-actions">
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={() => setCapture('thumb')}
                    >
                      <CameraIcon size={15} />
                      Camera
                    </button>
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={() => inputThumb.current.click()}
                    >
                      <Upload size={15} />
                      Upload
                    </button>
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={openScanner}
                    >
                      <ScanLine size={15} />
                      Scanner
                    </button>
                  </div>
                </div>
              )}
            </section>
            <section className="proof-panel photos-panel">
              <div className="proof-heading">
                <span>
                  Photos <small>{photos.length}/8</small>
                </span>
                <div className="button-row">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Take customer photo"
                    onClick={() => setCapture('photo')}
                  >
                    <CameraIcon size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Upload customer photo"
                    onClick={() => inputPhoto.current.click()}
                  >
                    <Upload size={17} />
                  </button>
                </div>
              </div>
              <div className="photo-strip">
                {photos.map((p, i) => (
                  <div className="photo-tile" key={p.url}>
                    <img src={p.url} alt={'Photo ' + (i + 1)} />
                    <button
                      type="button"
                      aria-label={'Remove photo ' + (i + 1)}
                      onClick={() => setPhotos(photos.filter((_, n) => n !== i))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {photos.length < 8 && (
                  <button
                    className="add-photo"
                    type="button"
                    onClick={() => inputPhoto.current.click()}
                  >
                    <Plus size={20} />
                    <span>Add photo</span>
                  </button>
                )}
              </div>
            </section>
          </div>
          <input
            ref={inputPhoto}
            hidden
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              if (e.target.files[0]) addPhoto(e.target.files[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={inputThumb}
            hidden
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              if (e.target.files[0]) addThumb(e.target.files[0], 'ink');
              e.target.value = '';
            }}
          />
        </fieldset>
        {error && <Notice error>{error}</Notice>}
        <div className="entry-save-row">
          {saved ? (
            <div className="saved-message">
              <Check size={17} />
              <strong>Saved · {saved.reference}</strong>
              <button type="button" className="btn primary small" onClick={() => onOpen(saved._id, true)}>
                <Printer size={15} />
                Receipt
              </button>
            </div>
          ) : (
            <>
              <div className="save-total">
                <span>Total</span>
                <strong>{money(sums.totalPaisa, 2)}</strong>
              </div>
              <button
                className="btn primary save-btn"
                disabled={busy || !connected}
                title={!connected ? 'Connect the backend to save' : undefined}
              >
                {busy ? <Spinner /> : <Save size={18} />}Save bill
              </button>
            </>
          )}
        </div>
      </form>
      {capture && (
        <Camera
          kind={capture}
          onCapture={(file) => (capture === 'photo' ? addPhoto(file) : addThumb(file, 'camera'))}
          onClose={() => setCapture(null)}
        />
      )}
      {scanner && (
        <Modal title="Capture from scanner" onClose={() => setScanner(false)}>
          <div className="modal-body">
            {!shop.scannerUrl ? (
              <Notice>Add the scanner bridge URL in Settings.</Notice>
            ) : (
              <>
                {token ? (
                  <span className="scanner-token-note">Pairing token loaded from Settings</span>
                ) : (
                  <Notice>Add the scanner pairing token in Settings first.</Notice>
                )}

                {scannerPreview ? (
                  <div className="scanner-preview">
                    <div className="scanner-preview-image">
                      <img src={scannerPreview.url} alt="Captured fingerprint preview" />
                    </div>
                    <div className="scanner-preview-status">
                      <span className="captured">
                        <Check size={14} />
                        Fingerprint captured — check image clarity
                      </span>
                    </div>
                    <div className="scanner-preview-actions">
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy || !token.trim()}
                        onClick={scan}
                      >
                        {busy ? <Spinner /> : <ScanLine size={16} />}
                        Recapture
                      </button>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busy}
                        onClick={() => setScanner(false)}
                      >
                        <Check size={16} />
                        Use fingerprint
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy || !token.trim()}
                    onClick={scan}
                  >
                    {busy ? <Spinner /> : <Fingerprint size={18} />}
                    {busy ? 'Scanning...' : 'Capture fingerprint'}
                  </button>
                )}

              </>
            )}
            {error && <Notice error>{error}</Notice>}
          </div>
        </Modal>
      )}
    </div>
  );
}
