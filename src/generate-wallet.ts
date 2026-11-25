import fs from 'node:fs';
import path from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envPath)) {
  const existing = fs.readFileSync(envPath, 'utf8');
  const match = existing.match(/^AGENT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m);
  if (match && match[1] !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
    const acct = privateKeyToAccount(match[1] as `0x${string}`);
    console.log('Existing throwaway testnet agent wallet found in .env:');
    console.log('  Address (Base Sepolia):', acct.address);
    console.log('  Fund with free Base Sepolia USDC at: https://faucet.circle.com/');
    process.exit(0);
  }
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

const envContent = `# Auto-generated throwaway testnet wallet for ClaimProof Agent (NEVER use on mainnet!)
AGENT_PRIVATE_KEY=${privateKey}
TELEGRAPH_BASE_URL=https://devnode.telegraphprotocol.com
MAX_BUDGET_USD=0.05
PORT=3456
`;

fs.writeFileSync(envPath, envContent, { mode: 0o600 });
console.log('Generated new throwaway testnet wallet and saved to .env (mode 0600).');
console.log('  Address (Base Sepolia):', account.address);
console.log('  Next step: get free Base Sepolia Test USDC at https://faucet.circle.com/ (no ETH gas needed for x402!)');
