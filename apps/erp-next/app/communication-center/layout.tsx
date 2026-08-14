import './v4.css';
import './whatsapp-web-v7.css';

export default function CommunicationCenterLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="communication-v4">{children}</div>;
}
