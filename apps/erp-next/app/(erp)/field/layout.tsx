import { BrowserFieldScopeStatus } from '../../../components/field/browser-field-scope-status';

export default function FieldLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><BrowserFieldScopeStatus />{children}</>;
}
