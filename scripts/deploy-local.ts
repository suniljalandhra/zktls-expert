import { createRequire } from 'node:module';
import { ContractFactory, JsonRpcProvider, NonceManager, Wallet, ZeroAddress, getCreateAddress, parseEther } from 'ethers';
import { SCHEMA } from '../server/src/eas.ts';

// Deploys EAS's own SchemaRegistry + EAS contracts onto a local Anvil chain and registers our schema.
// Re-runnable: skips anything already on the chain (addresses are deterministic from the attester's nonce).

const require = createRequire(import.meta.url);
const { SchemaRegistry } = require('@ethereum-attestation-service/eas-sdk') as typeof import('@ethereum-attestation-service/eas-sdk');
const artifacts = '@ethereum-attestation-service/eas-contracts/artifacts/contracts';
const registryArtifact = require(`${artifacts}/SchemaRegistry.sol/SchemaRegistry.json`);
const easArtifact = require(`${artifacts}/EAS.sol/EAS.json`);

const LOCAL_CHAIN_ID = 31337n;
const REVOCABLE = true;

const { ATTESTER_PRIVATE_KEY, RPC_URL } = process.env;
if (!ATTESTER_PRIVATE_KEY || !RPC_URL) throw new Error('Set ATTESTER_PRIVATE_KEY and RPC_URL in .env');

const provider = new JsonRpcProvider(RPC_URL);
const { chainId } = await provider.getNetwork().catch(() => {
  throw new Error(`No chain at ${RPC_URL}. Start it first: npm --prefix scripts run chain`);
});
// anvil_setBalance and free deploys only make sense on a throwaway local chain.
if (chainId !== LOCAL_CHAIN_ID) throw new Error(`Refusing to run: chain ${chainId} is not local (${LOCAL_CHAIN_ID})`);

const wallet = new Wallet(ATTESTER_PRIVATE_KEY, provider);
// NonceManager tracks nonces locally; back-to-back deploys otherwise reuse a cached nonce.
const signer = new NonceManager(wallet);
await provider.send('anvil_setBalance', [wallet.address, `0x${parseEther('100').toString(16)}`]);

// Nonce 0 deploys the registry, nonce 1 deploys EAS.
const registryAddress = getCreateAddress({ from: wallet.address, nonce: 0 });
const easAddress = getCreateAddress({ from: wallet.address, nonce: 1 });

async function deployOnce(address: string, name: string, artifact: { abi: unknown[]; bytecode: string }, args: unknown[]) {
  if ((await provider.getCode(address)) !== '0x') return console.log(`${name} already at ${address}`);
  const factory = new ContractFactory(artifact.abi as never, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const deployed = await contract.getAddress();
  if (deployed !== address) throw new Error(`${name} landed at ${deployed}, expected ${address}. Reset the chain.`);
  console.log(`${name} deployed at ${address}`);
}

await deployOnce(registryAddress, 'SchemaRegistry', registryArtifact, []);
await deployOnce(easAddress, 'EAS', easArtifact, [registryAddress]);

const registry = new SchemaRegistry(registryAddress);
registry.connect(signer);
const schemaUID = SchemaRegistry.getSchemaUID(SCHEMA, ZeroAddress, REVOCABLE);
const registered = await registry.getSchema({ uid: schemaUID }).then(() => true, () => false);
if (registered) console.log('Schema already registered');
else {
  await (await registry.register({ schema: SCHEMA, resolverAddress: ZeroAddress, revocable: REVOCABLE })).wait();
  console.log('Schema registered');
}

console.log(`\nPut these in .env:\nEAS_ADDRESS=${easAddress}\nSCHEMA_REGISTRY_ADDRESS=${registryAddress}\nSCHEMA_UID=${schemaUID}`);
