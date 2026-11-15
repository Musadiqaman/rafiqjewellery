import { useRef, useEffect, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  LoaderCircle,
  AlertCircle,
  Inbox,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
} from 'lucide-react';


const normalizeSelectOptions = (options) =>
  options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  );

export function SelectControl({
  value,
  onChange,
  options = [],
  placeholder = 'Select an option',
  ariaLabel = 'Select an option',
  disabled = false,
  className = '',
}) {
  const id = useId(),
    root = useRef(null),
    trigger = useRef(null),
    menu = useRef(null),
    [open, setOpen] = useState(false),
    [activeIndex, setActiveIndex] = useState(0),
    [position, setPosition] = useState(null);
  const items = normalizeSelectOptions(options),
    selectedIndex = items.findIndex((item) => String(item.value) === String(value)),
    selected = selectedIndex >= 0 ? items[selectedIndex] : null;

  function choose(index) {
    const item = items[index];
    if (!item || item.disabled) return;
    onChange(item.value);
    setOpen(false);
    trigger.current?.focus();
  }

  function handleKeyDown(event) {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        setOpen(true);
      } else {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((current) => {
          let next = current;
          for (let count = 0; count < items.length; count += 1) {
            next = (next + direction + items.length) % items.length;
            if (!items[next]?.disabled) return next;
          }
          return current;
        });
      }
    } else if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === ' ' && !open) {
      event.preventDefault();
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
      setOpen(true);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 170), window.innerWidth - 24),
        height = Math.min(280, Math.max(54, items.length * 42 + 12)),
        below = window.innerHeight - rect.bottom,
        top = below >= height + 12 ? rect.bottom + 7 : Math.max(12, rect.top - height - 7),
        left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      setPosition({ top, left, width });
    };
    const closeOutside = (event) => {
      if (
        !root.current?.contains(event.target) &&
        !menu.current?.contains(event.target)
      )
        setOpen(false);
    };
    updatePosition();
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, items.length]);

  useEffect(() => {
    if (open) setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  return (
    <div className={'select-control ' + className} ref={root}>
      <button
        ref={trigger}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id + '-listbox'}
        aria-activedescendant={open ? id + '-option-' + activeIndex : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span className={!selected ? 'select-placeholder' : ''}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={menu}
            id={id + '-listbox'}
            className="select-menu"
            role="listbox"
            aria-label={ariaLabel}
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
          >
            {items.map((item, index) => (
              <button
                key={String(item.value)}
                id={id + '-option-' + index}
                type="button"
                role="option"
                aria-selected={String(item.value) === String(value)}
                className="select-option"
                disabled={item.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

const parseDateKey = (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
};

const localDateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const karachiDateKey = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const dateLabel = (value) => {
  const date = parseDateKey(value);
  return date
    ? new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(date)
    : '';
};

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select date',
  ariaLabel = 'Select date',
}) {
  const id = useId(),
    trigger = useRef(null),
    popover = useRef(null),
    [open, setOpen] = useState(false),
    [position, setPosition] = useState(null),
    [visibleMonth, setVisibleMonth] = useState(() => {
      const initial = parseDateKey(value) || parseDateKey(karachiDateKey()) || new Date();
      return new Date(initial.getFullYear(), initial.getMonth(), 1);
    });
  const todayKey = karachiDateKey(),
    year = visibleMonth.getFullYear(),
    month = visibleMonth.getMonth(),
    firstWeekday = new Date(year, month, 1).getDay(),
    daysInMonth = new Date(year, month + 1, 0).getDate(),
    monthTitle = new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      year: 'numeric',
    }).format(visibleMonth),
    cells = [
      ...Array.from({ length: firstWeekday }, (_, index) => ({ key: 'blank-' + index })),
      ...Array.from({ length: daysInMonth }, (_, index) => {
        const date = new Date(year, month, index + 1);
        return { key: localDateKey(date), date, day: index + 1 };
      }),
    ];

  useEffect(() => {
    if (!value) return;
    const date = parseDateKey(value);
    if (date) setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24),
        height = 410,
        below = window.innerHeight - rect.bottom,
        top = below >= height + 12 ? rect.bottom + 8 : Math.max(12, rect.top - height - 8),
        left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      setPosition({ top, left, width });
    };
    const closeOutside = (event) => {
      if (
        !trigger.current?.contains(event.target) &&
        !popover.current?.contains(event.target)
      )
        setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    updatePosition();
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const inRange = (key) => (!min || key >= min) && (!max || key <= max);
  const choose = (key) => {
    if (!inRange(key)) return;
    onChange(key);
    setOpen(false);
  };

  return (
    <div className="date-picker-control">
      <button
        ref={trigger}
        type="button"
        className="date-picker-trigger"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id + '-calendar'}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="date-picker-value">
          <CalendarDays size={17} />
          {value ? dateLabel(value) : <span className="date-picker-placeholder">{placeholder}</span>}
        </span>
        <ChevronDown size={16} />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={popover}
            id={id + '-calendar'}
            className="date-picker-popover"
            role="dialog"
            aria-label={ariaLabel}
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
          >
            <div className="date-picker-month">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setVisibleMonth(new Date(year, month - 1, 1))}
              >
                <ChevronLeft size={19} />
              </button>
              <strong>{monthTitle}</strong>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setVisibleMonth(new Date(year, month + 1, 1))}
              >
                <ChevronRight size={19} />
              </button>
            </div>
            <div className="date-picker-weekdays" aria-hidden="true">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="date-picker-days">
              {cells.map((cell) =>
                cell.date ? (
                  <button
                    key={cell.key}
                    type="button"
                    className={[
                      'date-picker-day',
                      cell.key === value ? 'selected' : '',
                      cell.key === todayKey ? 'today' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-label={dateLabel(cell.key)}
                    aria-pressed={cell.key === value}
                    disabled={!inRange(cell.key)}
                    onClick={() => choose(cell.key)}
                  >
                    {cell.day}
                  </button>
                ) : (
                  <span key={cell.key} className="date-picker-empty" />
                ),
              )}
            </div>
            <div className="date-picker-footer">
              <button
                type="button"
                className="date-picker-text-action"
                disabled={!value}
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className="date-picker-text-action"
                disabled={!inRange(todayKey)}
                onClick={() => choose(todayKey)}
              >
                Today
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export const Spinner = () => <LoaderCircle className="spin" size={18} aria-label="Loading" />;
export function Notice({ children, error = false }) {
  return (
    <div className={'notice ' + (error ? 'error' : '')} role={error ? 'alert' : 'status'}>
      <AlertCircle size={16} />
      <span>{children}</span>
    </div>
  );
}
export function Field({ label, children, required = false, hint }) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <i> *</i>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const handle = (e) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const list = ref.current?.querySelectorAll(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea,a[href],[tabindex="0"]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handle);
      prev?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={'modal ' + (wide ? 'wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export const Status = ({ r }) => (
  <span className={'status ' + (r.voided ? 'void' : 'complete')}>
    <i />
    {r.voided ? 'Voided' : 'Saved'}
  </span>
);
export const Empty = ({ title = 'No purchases yet', text = '' }) => (
  <div className="empty">
    <Inbox size={30} />
    <h3>{title}</h3>
    {text && <p>{text}</p>}
  </div>
);
