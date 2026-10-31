'use client';

import { useEffect, useState } from 'react';
import { useConnection } from 'wagmi';
import { describeClaim } from './api';
import { ConnectWallet, Mono, Result, Step, Verify, short, type Done, type Flow } from './steps';

export default function Home() {
  const { address, isConnected } = useConnection();
  const [flow, setFlow] = useState<Flow>({ kind: 'idle' });

  // A different wallet means a different claim: start over.
  useEffect(() => setFlow({ kind: 'idle' }), [address]);

  const done: Done | null =
    flow.kind === 'waiting' && (flow.state.status === 'attested' || flow.state.status === 'verified')
      ? flow.state
      : null;
  const step = !isConnected ? 1 : done ? 3 : 2;

  return (
    <main className="page">
      <header className="intro">
        <h1>Prove your GitHub expertise</h1>
        <p>
          Sign in to GitHub through Reclaim. Our server checks the zkTLS proof and shows you the verified result. Your
          GitHub password and session never reach us.
        </p>
      </header>

      <ol className="steps">
        <Step n={1} title="Connect your wallet" current={step} summary={address && <Mono>{short(address)}</Mono>}>
          <ConnectWallet />
        </Step>
        <Step n={2} title="Verify with GitHub" current={step} summary={done && describeClaim(done.claim)}>
          {address && <Verify wallet={address} flow={flow} setFlow={setFlow} />}
        </Step>
        <Step n={3} title="Your verified claim" current={step}>
          {done && address && <Result result={done} wallet={address} />}
        </Step>
      </ol>
    </main>
  );
}
