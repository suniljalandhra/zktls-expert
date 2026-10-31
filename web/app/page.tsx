'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi';

// Phase 0 placeholder: wallet connect works, QR renders. The Reclaim flow lands in Phase 1.
export default function Home() {
  const { address, isConnected } = useConnection();
  const connectors = useConnectors();
  const { mutate: connect } = useConnect();
  const { mutate: disconnect } = useDisconnect();

  return (
    <main>
      <h1>zkTLS Expert</h1>
      {isConnected ? (
        <p>
          Connected: <code>{address}</code> <button onClick={() => disconnect()}>Disconnect</button>
        </p>
      ) : (
        connectors.map((connector) => (
          <button key={connector.uid} onClick={() => connect({ connector })}>
            Connect {connector.name}
          </button>
        ))
      )}
      <QRCodeSVG value="https://example.com/reclaim-request-url" size={160} />
    </main>
  );
}
