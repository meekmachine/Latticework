type SnippetModule = { default?: unknown } | unknown;
export type BundledSnippetModuleLoader = () => Promise<SnippetModule>;

import emotionAngry from './snippets/emotion/angry.json';
import emotionAnxious from './snippets/emotion/anxious.json';
import emotionCalm from './snippets/emotion/calm.json';
import emotionContempt from './snippets/emotion/contempt.json';
import emotionFlirty from './snippets/emotion/flirty.json';
import emotionHopeful from './snippets/emotion/hopeful.json';
import emotionHopeless from './snippets/emotion/hopeless.json';
import emotionOverwhelmed from './snippets/emotion/overwhelmed.json';
import emotionRelieved from './snippets/emotion/relieved.json';
import emotionSad from './snippets/emotion/sad.json';
import emotionSkeptical from './snippets/emotion/skeptical.json';
import emotionSmirk from './snippets/emotion/smirk.json';
import emotionStressed from './snippets/emotion/stressed.json';
import emotionSurprise from './snippets/emotion/surprise.json';
import emotionWink from './snippets/emotion/wink.json';
import emotionWorried from './snippets/emotion/worried.json';
import speakingBrowFrownAndTilt from './snippets/speaking/browFrownAndTilt.json';
import speakingBrowRaiseAndShortHeadNod from './snippets/speaking/browRaiseAndShortHeadNod.json';
import speakingBrowRaiseLong from './snippets/speaking/browRaiseLong.json';
import speakingBrowRaiseShort from './snippets/speaking/browRaiseShort.json';
import speakingHeadNodBig from './snippets/speaking/headNodBig.json';
import speakingHeadNodSmall from './snippets/speaking/headNodSmall.json';
import visemesLipsyncAmazing from './snippets/visemes/lipsync_amazing.json';
import visemesLipsyncAnthropic from './snippets/visemes/lipsync_anthropic.json';
import visemesLipsyncBeautiful from './snippets/visemes/lipsync_beautiful.json';
import visemesLipsyncGoodMorning from './snippets/visemes/lipsync_good_morning.json';
import visemesLipsyncHello from './snippets/visemes/lipsync_hello.json';
import visemesLipsyncHelloMumbled from './snippets/visemes/lipsync_hello_mumbled.json';
import visemesLipsyncHelloPrecise from './snippets/visemes/lipsync_hello_precise.json';
import visemesLipsyncHelloRelaxed from './snippets/visemes/lipsync_hello_relaxed.json';
import visemesLipsyncHelloTheatrical from './snippets/visemes/lipsync_hello_theatrical.json';
import visemesLipsyncHelloWorld from './snippets/visemes/lipsync_hello_world.json';
import visemesLipsyncHowAreYou from './snippets/visemes/lipsync_how_are_you.json';
import visemesLipsyncSpeech from './snippets/visemes/lipsync_speech.json';
import visemesLipsyncThankYou from './snippets/visemes/lipsync_thank_you.json';
import visemesLipsyncWorld from './snippets/visemes/lipsync_world.json';
import visemesPhraseVisemeSnippet from './snippets/visemes/phrase_viseme_snippet.json';
import visemesTest1 from './snippets/visemes/test1.json';
import eyeHeadTrackingEyePitch from './snippets/eyeHeadTracking/eyePitch.json';
import eyeHeadTrackingEyeRoll from './snippets/eyeHeadTracking/eyeRoll.json';
import eyeHeadTrackingEyeRollCircular from './snippets/eyeHeadTracking/eyeRollCircular.json';
import eyeHeadTrackingEyeYaw from './snippets/eyeHeadTracking/eyeYaw.json';
import eyeHeadTrackingHeadPitch from './snippets/eyeHeadTracking/headPitch.json';
import eyeHeadTrackingHeadRoll from './snippets/eyeHeadTracking/headRoll.json';
import eyeHeadTrackingHeadRollCircular from './snippets/eyeHeadTracking/headRollCircular.json';
import eyeHeadTrackingHeadYaw from './snippets/eyeHeadTracking/headYaw.json';

export const bundledSnippetModules = {
  emotionAnimationsList: {
    './snippets/emotion/angry.json': () => Promise.resolve(emotionAngry),
    './snippets/emotion/anxious.json': () => Promise.resolve(emotionAnxious),
    './snippets/emotion/calm.json': () => Promise.resolve(emotionCalm),
    './snippets/emotion/contempt.json': () => Promise.resolve(emotionContempt),
    './snippets/emotion/flirty.json': () => Promise.resolve(emotionFlirty),
    './snippets/emotion/hopeful.json': () => Promise.resolve(emotionHopeful),
    './snippets/emotion/hopeless.json': () => Promise.resolve(emotionHopeless),
    './snippets/emotion/overwhelmed.json': () => Promise.resolve(emotionOverwhelmed),
    './snippets/emotion/relieved.json': () => Promise.resolve(emotionRelieved),
    './snippets/emotion/sad.json': () => Promise.resolve(emotionSad),
    './snippets/emotion/skeptical.json': () => Promise.resolve(emotionSkeptical),
    './snippets/emotion/smirk.json': () => Promise.resolve(emotionSmirk),
    './snippets/emotion/stressed.json': () => Promise.resolve(emotionStressed),
    './snippets/emotion/surprise.json': () => Promise.resolve(emotionSurprise),
    './snippets/emotion/wink.json': () => Promise.resolve(emotionWink),
    './snippets/emotion/worried.json': () => Promise.resolve(emotionWorried),
  },
  speakingAnimationsList: {
    './snippets/speaking/browFrownAndTilt.json': () => Promise.resolve(speakingBrowFrownAndTilt),
    './snippets/speaking/browRaiseAndShortHeadNod.json': () => Promise.resolve(speakingBrowRaiseAndShortHeadNod),
    './snippets/speaking/browRaiseLong.json': () => Promise.resolve(speakingBrowRaiseLong),
    './snippets/speaking/browRaiseShort.json': () => Promise.resolve(speakingBrowRaiseShort),
    './snippets/speaking/headNodBig.json': () => Promise.resolve(speakingHeadNodBig),
    './snippets/speaking/headNodSmall.json': () => Promise.resolve(speakingHeadNodSmall),
  },
  visemeAnimationsList: {
    './snippets/visemes/lipsync_amazing.json': () => Promise.resolve(visemesLipsyncAmazing),
    './snippets/visemes/lipsync_anthropic.json': () => Promise.resolve(visemesLipsyncAnthropic),
    './snippets/visemes/lipsync_beautiful.json': () => Promise.resolve(visemesLipsyncBeautiful),
    './snippets/visemes/lipsync_good_morning.json': () => Promise.resolve(visemesLipsyncGoodMorning),
    './snippets/visemes/lipsync_hello.json': () => Promise.resolve(visemesLipsyncHello),
    './snippets/visemes/lipsync_hello_mumbled.json': () => Promise.resolve(visemesLipsyncHelloMumbled),
    './snippets/visemes/lipsync_hello_precise.json': () => Promise.resolve(visemesLipsyncHelloPrecise),
    './snippets/visemes/lipsync_hello_relaxed.json': () => Promise.resolve(visemesLipsyncHelloRelaxed),
    './snippets/visemes/lipsync_hello_theatrical.json': () => Promise.resolve(visemesLipsyncHelloTheatrical),
    './snippets/visemes/lipsync_hello_world.json': () => Promise.resolve(visemesLipsyncHelloWorld),
    './snippets/visemes/lipsync_how_are_you.json': () => Promise.resolve(visemesLipsyncHowAreYou),
    './snippets/visemes/lipsync_speech.json': () => Promise.resolve(visemesLipsyncSpeech),
    './snippets/visemes/lipsync_thank_you.json': () => Promise.resolve(visemesLipsyncThankYou),
    './snippets/visemes/lipsync_world.json': () => Promise.resolve(visemesLipsyncWorld),
    './snippets/visemes/phrase_viseme_snippet.json': () => Promise.resolve(visemesPhraseVisemeSnippet),
    './snippets/visemes/test1.json': () => Promise.resolve(visemesTest1),
  },
  eyeHeadTrackingAnimationsList: {
    './snippets/eyeHeadTracking/eyePitch.json': () => Promise.resolve(eyeHeadTrackingEyePitch),
    './snippets/eyeHeadTracking/eyeRoll.json': () => Promise.resolve(eyeHeadTrackingEyeRoll),
    './snippets/eyeHeadTracking/eyeRollCircular.json': () => Promise.resolve(eyeHeadTrackingEyeRollCircular),
    './snippets/eyeHeadTracking/eyeYaw.json': () => Promise.resolve(eyeHeadTrackingEyeYaw),
    './snippets/eyeHeadTracking/headPitch.json': () => Promise.resolve(eyeHeadTrackingHeadPitch),
    './snippets/eyeHeadTracking/headRoll.json': () => Promise.resolve(eyeHeadTrackingHeadRoll),
    './snippets/eyeHeadTracking/headRollCircular.json': () => Promise.resolve(eyeHeadTrackingHeadRollCircular),
    './snippets/eyeHeadTracking/headYaw.json': () => Promise.resolve(eyeHeadTrackingHeadYaw),
  },
} satisfies Record<string, Record<string, BundledSnippetModuleLoader>>;
