import { JsonRpcProvider, Wallet, formatEther } from 'ethers';

// Prints the attester's address and balance, so you know where to send Sepolia test ETH.
const { ATTESTER_PRIVATE_KEY, RPC_URL } = process.env;
if (!ATTESTER_PRIVATE_KEY || !RPC_URL) throw new Error('Set ATTESTER_PRIVATE_KEY and RPC_URL in .env');
const provider = new JsonRpcProvider(RPC_URL);
const { address } = new Wallet(ATTESTER_PRIVATE_KEY);
console.log(`attester ${address}, balance ${formatEther(await provider.getBalance(address))} ETH`);
