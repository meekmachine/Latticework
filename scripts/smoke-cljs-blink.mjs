import {
  createAnimationAgency,
  createBlinkAgency,
  createGazeAgency,
  createHairAgency,
} from '../dist/cljs/index.js';

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

const animationScheduled = [];
const animationRemoved = [];
const animationEffects = [];
const animationEvents = [];
const animationStates = [];

const animation = createAnimationAgency(
  undefined,
  {
    scheduleSnippet(snippet, opts) {
      animationScheduled.push({ snippet, opts });
      return snippet.name;
    },
    updateSnippet(snippet) {
      animationEffects.push({ op: 'hostUpdateSnippet', snippet });
      return snippet.name;
    },
    removeSnippet(name) {
      animationRemoved.push(name);
    },
    seekSnippet(name, offsetSec) {
      animationEffects.push({ op: 'hostSeekSnippet', name, offsetSec });
    },
    pauseSnippet(name) {
      animationEffects.push({ op: 'hostPauseSnippet', name });
    },
    resumeSnippet(name) {
      animationEffects.push({ op: 'hostResumeSnippet', name });
    },
    play() {
      animationEffects.push({ op: 'hostPlayAll' });
    },
    pause() {
      animationEffects.push({ op: 'hostPauseAll' });
    },
    stop() {
      animationEffects.push({ op: 'hostStopAll' });
    },
    setSnippetPlaybackRate(name, rate) {
      animationEffects.push({ op: 'hostSetRate', name, rate });
    },
    setSnippetIntensityScale(name, scale) {
      animationEffects.push({ op: 'hostSetScale', name, scale });
    },
    onAnimationEffect(effect) {
      animationEffects.push(effect);
    },
    onAnimationEvent(event) {
      animationEvents.push(event);
    },
    onState(state) {
      if (state?.globalPlaybackState) {
        animationStates.push(state);
      }
    },
  },
);

const animationName = animation.schedule(
  {
    name: 'cljs_smile',
    snippetCategory: 'auSnippet',
    curves: {
      12: [
        { time: 0, intensity: 0 },
        { time: 0.2, intensity: 0.75 },
      ],
    },
  },
  { autoPlay: true, priority: 42, offsetSec: 0.05 },
);

if (animationName !== 'cljs_smile') {
  throw new Error(`Expected scheduled animation name, received ${animationName}`);
}

if (animationScheduled.length !== 1 || animationScheduled[0].opts?.autoPlay !== true) {
  throw new Error(`Expected animation host schedule, received ${JSON.stringify(animationScheduled)}`);
}

let animationState = animation.getState();
const normalizedAnimation = animationState.snippets.cljs_smile;
if (!normalizedAnimation?.isPlaying || normalizedAnimation.duration !== 0.2 || normalizedAnimation.snippetPriority !== 42) {
  throw new Error(`Unexpected normalized animation state: ${JSON.stringify(normalizedAnimation)}`);
}

animation.setSnippetPlaybackRate('cljs_smile', 1.5);
animation.setSnippetIntensityScale('cljs_smile', 0.4);
animation.seek('cljs_smile', 0.1);
animation.pause();
animation.play();

const scheduleSnapshot = animation.getScheduleSnapshot();
if (scheduleSnapshot[0]?.name !== 'cljs_smile' || scheduleSnapshot[0]?.offset !== 0.1) {
  throw new Error(`Unexpected animation schedule snapshot: ${JSON.stringify(scheduleSnapshot)}`);
}

animation.updateSnippet({
  name: 'cljs_smile',
  curves: {
    12: [
      { time: 0, intensity: 0.1 },
      { time: 0.3, intensity: 0.9 },
    ],
  },
});

animationState = animation.getState();
if (animationState.snippets.cljs_smile.duration !== 0.3) {
  throw new Error(`Expected animation update to recalculate duration, received ${animationState.snippets.cljs_smile.duration}`);
}

animation.remove('cljs_smile');
if (!animationRemoved.includes('cljs_smile')) {
  throw new Error('Expected animation remove to hit host removeSnippet');
}

if (animation.getState().order.length !== 0) {
  throw new Error(`Expected animation registry to be empty after remove: ${JSON.stringify(animation.getState())}`);
}

if (!animationEvents.some((event) => event.type === 'GLOBAL_PLAYBACK_CHANGED' && event.state === 'playing')) {
  throw new Error(`Expected animation play event, saw ${JSON.stringify(animationEvents)}`);
}

if (animationStates.length < 8) {
  throw new Error(`Expected animation state callbacks, received ${animationStates.length}`);
}

animation.dispose();

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

const hairObjectStates = [];
const hairPhysicsUpdates = [];
const hairStates = [];

const hair = createHairAgency(
  undefined,
  {
    applyHairStateToObject(name, objectState) {
      hairObjectStates.push({ name, objectState });
    },
    applyHairPhysics(enabled, config) {
      hairPhysicsUpdates.push({ enabled, config });
    },
    onState(state) {
      if (state?.hairState) {
        hairStates.push(state);
      }
    },
  },
);

hair.registerObjects([
  { name: 'Bangs', isEyebrow: false, isMesh: true },
  { name: 'Left_Brow', isEyebrow: true, isMesh: true },
  { name: 'Hair_Root', isEyebrow: false, isMesh: false },
]);

if (hairObjectStates.length !== 0) {
  throw new Error('Expected registerObjects to preserve model hair without applying default colors');
}

hair.setHairBaseColor('#112233');

if (hairObjectStates.length !== 2) {
  throw new Error(`Expected two mesh hair object updates, received ${hairObjectStates.length}`);
}

const bangsUpdate = hairObjectStates.find((entry) => entry.name === 'Bangs');
if (bangsUpdate?.objectState.color.baseColor !== '#112233') {
  throw new Error(`Expected Bangs base color to update, received ${bangsUpdate?.objectState.color.baseColor}`);
}

const eyebrowUpdate = hairObjectStates.find((entry) => entry.name === 'Left_Brow');
if (eyebrowUpdate?.objectState.color.baseColor !== '#4a3728') {
  throw new Error(`Expected eyebrow color to remain default brown, received ${eyebrowUpdate?.objectState.color.baseColor}`);
}

hair.setPartVisibility('Bangs', false);
hair.setPartScale('Bangs', 1.25);
hair.setPartPosition('Bangs', [0.1, -0.2, 0.3]);
hair.setOutline(true, '#ff00ff', 0.5);
hair.send({ type: 'SET_EYEBROW_BASE_COLOR', baseColor: '#445566' });
hair.setPhysicsEnabled(true);
hair.updatePhysicsConfig({ windStrength: 0.4 });

const hairState = hair.getState();
const bangsState = hairState.hairState.parts.Bangs;

if (hairState.hairState.hairColor.baseColor !== '#112233') {
  throw new Error(`Expected hair color in CLJS state, received ${hairState.hairState.hairColor.baseColor}`);
}

if (hairState.hairState.eyebrowColor.baseColor !== '#445566') {
  throw new Error(`Expected eyebrow color from legacy event, received ${hairState.hairState.eyebrowColor.baseColor}`);
}

if (bangsState?.visible !== false || bangsState?.scale !== 1.25 || bangsState?.position?.[2] !== 0.3) {
  throw new Error(`Unexpected Bangs part state: ${JSON.stringify(bangsState)}`);
}

if (hairState.hairState.showOutline !== true || hairState.hairState.outlineOpacity !== 0.5) {
  throw new Error(`Unexpected outline state: ${JSON.stringify(hairState.hairState)}`);
}

const physicsConfig = hair.getPhysicsConfig();
if (physicsConfig.enabled !== true || physicsConfig.windStrength !== 0.4) {
  throw new Error(`Unexpected hair physics config: ${JSON.stringify(physicsConfig)}`);
}

if (hairPhysicsUpdates.length !== 2) {
  throw new Error(`Expected two hair physics updates, received ${hairPhysicsUpdates.length}`);
}

hair.resetToDefault();
if (hair.getHairState().hairColor.baseColor !== '#4a3728') {
  throw new Error('Expected resetToDefault to restore natural brown hair');
}

if (hairStates.length < 8) {
  throw new Error(`Expected hair state callbacks for registration and updates, received ${hairStates.length}`);
}

hair.dispose();

console.log(
  `CLJS smoke passed: blink ${snippet.name}; automatic count ${scheduledAfterAuto - 1}; animation states ${animationStates.length}; gaze snippets ${gazeScheduled.length}; hair states ${hairStates.length}`,
);
