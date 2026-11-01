'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useEffect, type ReactNode } from 'react';
import { useConnect, useConnectors, useDisconnect, useSignMessage } from 'wagmi';
import { createSession, describeClaim, getChallenge, getSession, type SessionState } from './api';

const POLL_MS = 3000;

export type Flow =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'waiting'; sessionId: string; requestUrl: string; state: SessionState }
  | { kind: 'error'; message: string };

export type Done = Extract<SessionState, { status: 'attested' | 'verified' }>;

export function Step(props: { n: number; title: string; current: number; summary?: ReactNode; children: ReactNode }) {
  const state = props.n < props.current ? 'done' : props.n === props.current ? 'active' : 'upcoming';
  return (
    <li className={`step step-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
      <span className="step-marker" aria-hidden="true">
        {state === 'done' ? '✓' : props.n}
      </span>
      <div className="step-body">
        <h2 className="step-title">{props.title}</h2>
        {state === 'done' && props.summary && <p className="step-summary">{props.summary}</p>}
        {state === 'active' && props.children}
      </div>
    </li>
  );
}

export function ConnectWallet() {
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();

  if (connectors.length === 0) {
    return <p className="hint">No browser wallet found. Install one such as MetaMask, then reload this page.</p>;
  }
  return (
    <div className="stack">
      <p className="hint">Your GitHub proof is bound to this address.</p>
      <div className="row">
        {connectors.map((connector) => (
          <button key={connector.uid} className="btn" disabled={isPending} onClick={() => connect({ connector })}>
            {isPending ? 'Connecting…' : `Connect ${connector.name === 'Injected' ? 'browser wallet' : connector.name}`}
          </button>
        ))}
      </div>
      {error && <p className="error">{friendly(error)}</p>}
    </div>
  );
}

export function Verify(props: { wallet: string; flow: Flow; setFlow: (f: Flow) => void }) {
  const { wallet, flow, setFlow } = props;
  const { mutateAsync: signMessage } = useSignMessage();
  const { mutate: disconnect } = useDisconnect();

  const waiting = flow.kind === 'waiting' && (flow.state.status === 'pending' || flow.state.status === 'verifying');
  const sessionId = flow.kind === 'waiting' ? flow.sessionId : null;

  useEffect(() => {
    if (!waiting || !sessionId || flow.kind !== 'waiting') return;
    const { requestUrl } = flow;
    const timer = setInterval(async () => {
      try {
        const state = await getSession(sessionId);
        if (state.status === 'failed') setFlow({ kind: 'error', message: state.error });
        else setFlow({ kind: 'waiting', sessionId, requestUrl, state });
      } catch (e) {
        setFlow({ kind: 'error', message: (e as Error).message });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, sessionId]);

  async function start() {
    setFlow({ kind: 'starting' });
    try {
      const { nonce, message } = await getChallenge(wallet);
      const signature = await signMessage({ message });
      const { sessionId, requestUrl } = await createSession(wallet, nonce, signature);
      setFlow({ kind: 'waiting', sessionId, requestUrl, state: { status: 'pending' } });
    } catch (e) {
      setFlow({ kind: 'error', message: friendly(e) });
    }
  }

  if (flow.kind === 'waiting') {
    const checking = flow.state.status === 'verifying';
    return (
      <div className="stack">
        <div className="qr-row">
          <div className="qr">
            <QRCodeSVG value={flow.requestUrl} size={168} marginSize={2} title="Reclaim verification link" />
          </div>
          <div className="stack">
            <p>Scan with your phone and sign in to GitHub, or open the link on this device.</p>
            <a className="btn btn-quiet" href={flow.requestUrl} target="_blank" rel="noopener noreferrer">
              Open verification link
            </a>
          </div>
        </div>
        <p className="status" role="status" aria-live="polite">
          <span className="pulse" aria-hidden="true" />
          {checking ? 'Proof received. Checking it…' : 'Waiting for you to finish in Reclaim…'}
        </p>
        {!checking && (
          <button className="link" onClick={() => setFlow({ kind: 'idle' })}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="hint">
        First you sign a message to prove you own <Mono>{short(wallet)}</Mono>. Signing is free and sends no
        transaction.
      </p>
      {flow.kind === 'error' && <p className="error">{sentence(flow.message)}</p>}
      <div className="row">
        <button className="btn" disabled={flow.kind === 'starting'} onClick={start}>
          {flow.kind === 'starting' ? 'Waiting for signature…' : flow.kind === 'error' ? 'Try again' : 'Verify with GitHub'}
        </button>
        <button className="link" onClick={() => disconnect()}>
          Use a different wallet
        </button>
      </div>
    </div>
  );
}

export function Result({ result, wallet }: { result: Done; wallet: string }) {
  return (
    <article className="credential">
      <ContributionGrid />
      <div className="credential-body">
        <p className="credential-claim">{describeClaim(result.claim)}</p>
        <dl className="credential-facts">
          <dt>Wallet</dt>
          <dd>
            <Mono>{short(wallet)}</Mono>
          </dd>
          <dt>Method</dt>
          <dd>Reclaim zkTLS proof from github.com</dd>
          {result.status === 'attested' && (
            <>
              <dt>Attestation</dt>
              <dd>
                <Mono>{short(result.uid)}</Mono>
              </dd>
            </>
          )}
        </dl>
        {result.status === 'verified' ? (
          <p className="hint">Checked by our server against the attestor signatures. Nothing was written on-chain.</p>
        ) : result.explorerUrl ? (
          <a className="btn" href={result.explorerUrl} target="_blank" rel="noopener noreferrer">
            View on EAS Scan
          </a>
        ) : (
          <p className="hint">
            Recorded on the local development chain in transaction <Mono>{short(result.txHash)}</Mono>. No public
            explorer can see it.
          </p>
        )}
      </div>
    </article>
  );
}

// The one animated moment: a contribution-graph motif that fills in when the attestation lands.
function ContributionGrid() {
  const cols = 26;
  const cells = Array.from({ length: 7 * cols }, (_, i) => (i * 37 + (i % 7) * 11) % 5);
  return (
    <div className="grid" aria-hidden="true">
      {cells.map((level, i) => (
        <span key={i} className={`cell l${level}`} style={{ animationDelay: `${(i % cols) * 25 + Math.floor(i / cols) * 10}ms` }} />
      ))}
    </div>
  );
}

export const Mono = ({ children }: { children: ReactNode }) => <code className="mono">{children}</code>;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).replace(/([^.])$/, '$1.');

export const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;

function friendly(e: unknown): string {
  const message = (e as Error)?.message ?? String(e);
  if (/user rejected|denied/i.test(message)) return 'You declined the request in your wallet. Try again when ready.';
  return message.split('\n')[0];
}
