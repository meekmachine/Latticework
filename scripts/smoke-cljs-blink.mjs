import { createBlinkAgency } from '../dist/cljs/index.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduled = [];
const states = [];

const agency = createBlinkAgency(
  { duration: 0.05, intensity: 0.5, randomness: 0, frequency: 60 },
  {
    scheduleSnippet(snippet, opts) {
      scheduled.push({ snippet, opts });
      return snippet.name;
    },
    onState(state) {
      states.push(state);
    },
  },
);

agency.triggerBlink();
const state = agency.getState();

if (scheduled.length !== 1) {
  throw new Error(`Expected one scheduled blink, received ${scheduled.length}`);
}

const [{ snippet, opts }] = scheduled;
const curve = snippet.curves?.['43'];

if (!Array.isArray(curve) || curve.length !== 7) {
  throw new Error(`Expected AU 43 curve with seven points, received ${curve?.length ?? 'none'}`);
}

if (opts?.autoPlay !== true) {
  throw new Error('Expected blink snippet to request autoPlay');
}

if (state.scheduledBlinkCount !== 1) {
  throw new Error(`Expected scheduledBlinkCount to be 1, received ${state.scheduledBlinkCount}`);
}

agency.enable();
await wait(1100);

if (scheduled.length < 2) {
  throw new Error(`Expected automatic blink after enable, received ${scheduled.length} scheduled snippets`);
}

const scheduledAfterAuto = scheduled.length;
agency.disable();
await wait(1100);

if (scheduled.length !== scheduledAfterAuto) {
  throw new Error(`Expected automatic blink timer to stop after disable, received ${scheduled.length - scheduledAfterAuto} extra snippets`);
}

if (states.length < 5) {
  throw new Error(`Expected initial, manual, enable, automatic, and disable state callbacks, received ${states.length}`);
}

agency.dispose();
console.log(`CLJS blink smoke passed: ${snippet.name}; automatic count ${scheduledAfterAuto - 1}`);
