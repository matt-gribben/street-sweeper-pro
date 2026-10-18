// Proves that tools run on plain Node 24 type stripping (no tsx) and can import src/sim code.
// Run: node tools/check-type-strip.ts
// tests/unit/map.test.ts runs this script and checks the map line, so the level compiler's dependency on
// src/sim/map.ts (TECHNICAL_DESIGN §2.1, §15.2) is proven to load under type stripping.
import { DT_S, MAX_STEPS_PER_FRAME, SIM_HZ } from '../src/sim/constants.ts';
import { COLLIDE, createBlankLevel, decodeLevel, encodeLevel, mergeSolids } from '../src/sim/map.ts';

console.log(`node ${process.version}`);
console.log(`SIM_HZ=${SIM_HZ}`);
console.log(`DT_S=${DT_S}`);
console.log(`MAX_STEPS_PER_FRAME=${MAX_STEPS_PER_FRAME}`);

const level = createBlankLevel('district.type_strip_probe', 3, 2);
level.layers.collide.fill(COLLIDE.SOLID, 0, 3);
level.solids = mergeSolids(level.layers.collide, 3, 2);
const text = encodeLevel(level);
const roundTrip = encodeLevel(decodeLevel(text)) === text;
console.log(`map.ts solids=${JSON.stringify(level.solids)} roundTrip=${roundTrip}`);
if (!roundTrip) process.exitCode = 1;
