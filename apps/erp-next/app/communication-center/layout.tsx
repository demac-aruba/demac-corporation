import { ComposerFocusRetention } from './composer-focus-retention';
import './v4.css';
import './v5-fix.css';
import './v6-chat-hotfix.css';

export default function CommunicationCenterLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="communication-v4"><ComposerFocusRetention />{children}</div>;
}
