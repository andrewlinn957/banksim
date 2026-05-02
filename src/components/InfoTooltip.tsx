import { ReactNode, useEffect, useRef, useState } from 'react';

interface Props {
  label?: string;
  content: ReactNode;
}

const InfoTooltip = ({ label = 'Info', content }: Props) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <span ref={containerRef} className="info-tooltip">
      <button
        type="button"
        className="info-tooltip-trigger"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        ?
      </button>
      {open && (
        <span className="info-tooltip-content" role="tooltip">
          {content}
        </span>
      )}
    </span>
  );
};

export default InfoTooltip;

