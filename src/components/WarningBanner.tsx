import { ReactNode } from 'react';

interface Props {
  title?: string;
  severity?: 'warning' | 'danger' | 'info';
  children: ReactNode;
}

const WarningBanner = ({ title, severity = 'warning', children }: Props) => (
  <div className={`alert ${severity}`}>
    {title && <div style={{ fontWeight: 700 }}>{title}</div>}
    <div className="muted" style={{ marginTop: title ? 4 : 0 }}>
      {children}
    </div>
  </div>
);

export default WarningBanner;

