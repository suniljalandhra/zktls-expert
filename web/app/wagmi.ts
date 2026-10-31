import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors/injected';
import { sepolia } from 'wagmi/chains';

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: { [sepolia.id]: http() },
  ssr: true,
});
