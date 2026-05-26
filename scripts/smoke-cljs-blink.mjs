import { createBlinkAgency, createGazeAgency } from '../dist/cljs/index.js';

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

const gazeScheduled = [];
const gazeRemoved = [];
const gazeStates = [];

const gaze = createGazeAgency(
  { smoothFactor: 1, minDelta: 0, duration: 200, headRoll: 0.25 },
  {
    scheduleSnippet(snippet, opts) {
      gazeScheduled.push({ snippet, opts });
      return snippet.name;
    },
    removeSnippet(name) {
      gazeRemoved.push(name);
    },
    onState(state) {
      gazeStates.push(state);
    },
  },
);

const gazeResult = gaze.schedule({ x: 0.5, y: -0.25, z: 0 });

if (gazeResult !== true) {
  throw new Error('Expected CLJS gaze schedule to report a scheduled animation');
}

if (gazeScheduled.length !== 5) {
  throw new Error(`Expected five gaze snippets, received ${gazeScheduled.length}`);
}

const expectedGazeNames = [
  'eyeHeadTracking/eyeYaw',
  'eyeHeadTracking/eyePitch',
  'eyeHeadTracking/headYaw',
  'eyeHeadTracking/headPitch',
  'eyeHeadTracking/headRoll',
];

for (const name of expectedGazeNames) {
  if (!gazeScheduled.some((entry) => entry.snippet.name === name)) {
    throw new Error(`Expected gaze snippet ${name}`);
  }

  if (!gazeRemoved.includes(name)) {
    throw new Error(`Expected existing gaze snippet ${name} to be removed before scheduling`);
  }
}

for (const { snippet: gazeSnippet, opts: gazeOpts } of gazeScheduled) {
  if (gazeOpts?.autoPlay !== true) {
    throw new Error(`Expected ${gazeSnippet.name} to request autoPlay`);
  }

  for (const curve of Object.values(gazeSnippet.curves ?? {})) {
    if (!Array.isArray(curve) || curve.length !== 2) {
      throw new Error(`Expected ${gazeSnippet.name} curves to have inherited start and target keyframes`);
    }
    if (curve[0]?.inherit !== true) {
      throw new Error(`Expected ${gazeSnippet.name} first keyframe to inherit live pose`);
    }
  }
}

const gazeState = gaze.getState();
if (
  gazeState.scheduledGazeCount !== 1 ||
  Math.abs(gazeState.current.x - 0.35) > 0.000001 ||
  Math.abs(gazeState.current.y - -0.175) > 0.000001
) {
  throw new Error(`Unexpected CLJS gaze state: ${JSON.stringify(gazeState)}`);
}

gaze.resetToNeutral(100);
const centered = gaze.getState();
if (centered.current.x !== 0 || centered.current.y !== 0) {
  throw new Error(`Expected resetToNeutral to schedule center gaze, received ${JSON.stringify(centered.current)}`);
}

gaze.stop();
if (gazeRemoved.length < 10) {
  throw new Error(`Expected gaze stop to remove all tracking snippets, saw ${gazeRemoved.length} removals`);
}

if (gazeStates.length < 4) {
  throw new Error(`Expected initial, schedule, reset, and stop gaze states, received ${gazeStates.length}`);
}

gaze.dispose();

console.log(`CLJS smoke passed: blink ${snippet.name}; automatic count ${scheduledAfterAuto - 1}; gaze snippets ${gazeScheduled.length}`);
