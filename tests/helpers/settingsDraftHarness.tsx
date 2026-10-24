import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Settings from '../../components/views/Settings';
import { I18nProvider } from '../../hooks/useI18n';
import { ToastProvider } from '../../components/common/Toast';
import type { Syndic } from '../../types';

const first = { id: 'cabinet-a', name: 'Syndic Al Manar', logoUrl: '', ice: '001234567000089',
  taxId: 'TAX-A', rc: 'RC-A', patente: 'PAT-A', buildings: [] } as unknown as Syndic;
const second = { ...first, id: 'cabinet-b', name: 'Cabinet Atlas', ice: '009876543000021',
  taxId: 'TAX-B', rc: 'RC-B', patente: 'PAT-B' };

function Harness() {
  const [cabinet, setCabinet] = useState(first);
  const [version, setVersion] = useState(0);
  const [applied, setApplied] = useState(0);
  const [remoteName, setRemoteName] = useState('Remote cabinet name');
  const [defer, setDefer] = useState(false);
  const [saved, setSaved] = useState<Syndic | null>(null);
  const pending = useRef<{ payload: Syndic; resolve: (value: Syndic) => void; reject: (error: Error) => void } | null>(null);
  const publish = (change: (previous: Syndic) => Syndic) => {
    setCabinet(change); setVersion(v => v + 1);
  };
  // This marker updates after child synchronization effects have been flushed.
  useEffect(() => setApplied(version), [cabinet, version]);
  const commit = (payload: Syndic) => {
    setSaved(payload);
    publish(previous => previous.id === payload.id ? { ...previous, ...payload } : previous);
    return payload;
  };
  return <>
    <aside aria-label="Settings component test controls">
      <output data-testid="applied-version">{applied}</output>
      <button onClick={() => publish(previous => ({ ...previous, buildings: [...previous.buildings], testAnnouncementRevision: version + 1 } as Syndic))}>Unrelated live update</button>
      <label>Remote name<input aria-label="Remote name" value={remoteName} onChange={event => setRemoteName(event.target.value)} /></label>
      <button onClick={() => publish(previous => ({ ...previous, name: remoteName, taxId: `REMOTE-TAX-${version + 1}` }))}>Incoming Settings update</button>
      <button onClick={() => publish(() => second)}>Switch cabinet</button>
      <label><input type="checkbox" checked={defer} onChange={event => setDefer(event.target.checked)} />Defer save</label>
      <button onClick={() => { const request = pending.current; if (request) { pending.current = null; request.resolve(commit(request.payload)); } }}>Complete save</button>
      <button onClick={() => { pending.current?.reject(new Error('Synthetic Settings save failure')); pending.current = null; }}>Reject save</button>
      <pre data-testid="saved-cabinet">{JSON.stringify(saved)}</pre>
    </aside>
    <Settings syndic={cabinet} onUpdate={payload => defer
      ? new Promise<Syndic>((resolve, reject) => { pending.current = { payload, resolve, reject }; })
      : Promise.resolve(commit(payload))} />
  </>;
}

createRoot(document.getElementById('root')!).render(<I18nProvider><ToastProvider><Harness /></ToastProvider></I18nProvider>);
