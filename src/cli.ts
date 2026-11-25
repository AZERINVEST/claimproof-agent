import 'dotenv/config';
import { runClaimProofAgent } from './agent.js';

function arg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

async function main() {
  const input = {
    flightNumber: arg('--flight', 'LH400'),
    airline: arg('--airline', 'Lufthansa'),
    origin: arg('--origin', 'FRA').toUpperCase(),
    destination: arg('--destination', 'JFK').toUpperCase(),
    date: arg('--date', new Date().toISOString().slice(0, 10)),
    ticketPriceUsd: Number(arg('--price', '780')),
    fareClass: arg('--fare', 'Economy Light (Non-refundable)'),
    bookingRef: arg('--ref', 'XK94LM'),
    passengerName: arg('--name', 'Alex Rivera'),
    maxBudgetUsd: Number(arg('--budget', process.env.MAX_BUDGET_USD || '0.03')),
    includeRebooking: !process.argv.includes('--no-rebooking'),
  };

  console.log(`\nRunning ClaimProof Agent for ${input.airline} ${input.flightNumber} (${input.origin} -> ${input.destination})...`);
  const packet = await runClaimProofAgent(input);
  console.log(`\nStatus: ${packet.status} | Total Cost: $${packet.totalCostUsd.toFixed(2)} USDC\n`);
  console.log(packet.claimLetter);
}

main().catch((err) => {
  console.error('\n[ClaimProof Blocked / Error]:', err.message);
  if (err.detail) console.error('Detail:', err.detail);
  process.exit(1);
});
