import './v4.css';
import './v5-fix.css';

export default function CommunicationCenterLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="communication-v4">{children}</div>;
}
