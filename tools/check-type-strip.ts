// Proves that tools run on plain Node 24 type stripping (no tsx) and can import src/sim code.
// Run: node tools/check-type-strip.ts
import { DT_S, MAX_STEPS_PER_FRAME, SIM_HZ } from '../src/sim/constants.ts';

console.log(`node ${process.version}`);
console.log(`SIM_HZ=${SIM_HZ}`);
console.log(`DT_S=${DT_S}`);
console.log(`MAX_STEPS_PER_FRAME=${MAX_STEPS_PER_FRAME}`);
