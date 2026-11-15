import { useEffect, useRef } from 'react';
import { PenLine, RotateCcw } from 'lucide-react';
export function SignaturePad({ value, onChange }) {
  const ref = useRef(null),
    drawing = useRef(false),
    current = useRef(value);
  current.current = value;
  useEffect(() => {
    const canvas = ref.current;
    const observer = new ResizeObserver(() => {
      const width = canvas.getBoundingClientRect().width,
        dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = 104 * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = '#29261e';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (current.current) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, width, 104);
        img.src = current.current;
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!value && ref.current)
      ref.current.getContext('2d').clearRect(0, 0, ref.current.width, ref.current.height);
  }, [value]);
  const point = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  return (
    <div className="signature-wrap">
      <div className="signature-canvas">
        <canvas
          ref={ref}
          aria-label="Draw seller signature here"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            const [x, y] = point(e),
              ctx = e.currentTarget.getContext('2d');
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.1, y + 0.1);
            ctx.stroke();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const [x, y] = point(e),
              ctx = e.currentTarget.getContext('2d');
            ctx.lineTo(x, y);
            ctx.stroke();
          }}
          onPointerUp={(e) => {
            if (drawing.current) {
              drawing.current = false;
              onChange(e.currentTarget.toDataURL('image/png'));
            }
          }}
          onPointerCancel={() => {
            drawing.current = false;
          }}
        />
        {!value && (
          <span className="signature-hint">
            <PenLine size={21} />
            Sign here
          </span>
        )}
        <span className="signature-line" />
      </div>
      <button type="button" className="text-btn" onClick={() => onChange('')}>
        <RotateCcw size={13} />
        Clear
      </button>
    </div>
  );
}
