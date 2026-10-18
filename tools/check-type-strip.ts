// Proves that tools run on plain Node 24 type stripping (no tsx) and can import src/sim code, including
// src/sim/tuning.ts and its `with { type: 'json' }` import of src/data/tuning.json (SSP-029).
// Run: node tools/check-type-strip.ts
import { DT_S, MAX_STEPS_PER_FRAME, SIM_HZ } from '../src/sim/constants.ts';
import { DEFAULT_TUNING } from '../src/sim/tuning.ts';

const sweeper = DEFAULT_TUNING.vehicle.sweeper;

console.log(`node ${process.version}`);
console.log(`SIM_HZ=${SIM_HZ}`);
console.log(`DT_S=${DT_S}`);
console.log(`MAX_STEPS_PER_FRAME=${MAX_STEPS_PER_FRAME}`);
console.log(`tuning.vehicle.sweeper.drive.topSpeedTransitMps=${sweeper.drive.topSpeedTransitMps}`);
console.log(`tuning.vehicle.sweeper.steering.maxSteerRad=${sweeper.steering.maxSteerRad}`);
