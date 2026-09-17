import type { Metadata } from 'next';
import WebsiteEditorWorkspace from '@/components/website-editor/editor-workspace';
export const metadata: Metadata = { title: 'Website Content Editor', robots: { index: false, follow: false, nocache: true } };
export default function WebsiteEditorPage() { return <WebsiteEditorWorkspace />; }
