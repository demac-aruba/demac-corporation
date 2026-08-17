import { ComposerFocusRetention } from './composer-focus-retention';
import { InboxPipelineNavigation } from './inbox-pipeline-navigation';
import './v4.css';
import './v5-fix.css';
import './v6-chat-hotfix.css';
import './v7-inbox-navigation.css';

export default function CommunicationCenterLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="communication-v4"><ComposerFocusRetention /><InboxPipelineNavigation />{children}</div>;
}
