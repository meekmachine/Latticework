type SnippetModule = { default?: unknown } | unknown;

import emotion_angry from './snippets/emotion/angry.json';
import emotion_anxious from './snippets/emotion/anxious.json';
import emotion_calm from './snippets/emotion/calm.json';
import emotion_contempt from './snippets/emotion/contempt.json';
import emotion_flirty from './snippets/emotion/flirty.json';
import emotion_hopeful from './snippets/emotion/hopeful.json';
import emotion_hopeless from './snippets/emotion/hopeless.json';
import emotion_overwhelmed from './snippets/emotion/overwhelmed.json';
import emotion_relieved from './snippets/emotion/relieved.json';
import emotion_sad from './snippets/emotion/sad.json';
import emotion_skeptical from './snippets/emotion/skeptical.json';
import emotion_smirk from './snippets/emotion/smirk.json';
import emotion_stressed from './snippets/emotion/stressed.json';
import emotion_surprise from './snippets/emotion/surprise.json';
import emotion_wink from './snippets/emotion/wink.json';
import emotion_worried from './snippets/emotion/worried.json';

import speaking_browFrownAndTilt from './snippets/speaking/browFrownAndTilt.json';
import speaking_browRaiseAndShortHeadNod from './snippets/speaking/browRaiseAndShortHeadNod.json';
import speaking_browRaiseLong from './snippets/speaking/browRaiseLong.json';
import speaking_browRaiseShort from './snippets/speaking/browRaiseShort.json';
import speaking_headNodBig from './snippets/speaking/headNodBig.json';
import speaking_headNodSmall from './snippets/speaking/headNodSmall.json';

import viseme_lipsync_amazing from './snippets/visemes/lipsync_amazing.json';
import viseme_lipsync_anthropic from './snippets/visemes/lipsync_anthropic.json';
import viseme_lipsync_beautiful from './snippets/visemes/lipsync_beautiful.json';
import viseme_lipsync_good_morning from './snippets/visemes/lipsync_good_morning.json';
import viseme_lipsync_hello from './snippets/visemes/lipsync_hello.json';
import viseme_lipsync_hello_mumbled from './snippets/visemes/lipsync_hello_mumbled.json';
import viseme_lipsync_hello_precise from './snippets/visemes/lipsync_hello_precise.json';
import viseme_lipsync_hello_relaxed from './snippets/visemes/lipsync_hello_relaxed.json';
import viseme_lipsync_hello_theatrical from './snippets/visemes/lipsync_hello_theatrical.json';
import viseme_lipsync_hello_world from './snippets/visemes/lipsync_hello_world.json';
import viseme_lipsync_how_are_you from './snippets/visemes/lipsync_how_are_you.json';
import viseme_lipsync_speech from './snippets/visemes/lipsync_speech.json';
import viseme_lipsync_thank_you from './snippets/visemes/lipsync_thank_you.json';
import viseme_lipsync_world from './snippets/visemes/lipsync_world.json';
import viseme_phrase_viseme_snippet from './snippets/visemes/phrase_viseme_snippet.json';
import viseme_test1 from './snippets/visemes/test1.json';

import eyeHeadTracking_eyePitch from './snippets/eyeHeadTracking/eyePitch.json';
import eyeHeadTracking_eyeRoll from './snippets/eyeHeadTracking/eyeRoll.json';
import eyeHeadTracking_eyeRollCircular from './snippets/eyeHeadTracking/eyeRollCircular.json';
import eyeHeadTracking_eyeYaw from './snippets/eyeHeadTracking/eyeYaw.json';
import eyeHeadTracking_headPitch from './snippets/eyeHeadTracking/headPitch.json';
import eyeHeadTracking_headRoll from './snippets/eyeHeadTracking/headRoll.json';
import eyeHeadTracking_headRollCircular from './snippets/eyeHeadTracking/headRollCircular.json';
import eyeHeadTracking_headYaw from './snippets/eyeHeadTracking/headYaw.json';

export const emotionSnippets: Record<string, SnippetModule> = {
  './snippets/emotion/angry.json': emotion_angry,
  './snippets/emotion/anxious.json': emotion_anxious,
  './snippets/emotion/calm.json': emotion_calm,
  './snippets/emotion/contempt.json': emotion_contempt,
  './snippets/emotion/flirty.json': emotion_flirty,
  './snippets/emotion/hopeful.json': emotion_hopeful,
  './snippets/emotion/hopeless.json': emotion_hopeless,
  './snippets/emotion/overwhelmed.json': emotion_overwhelmed,
  './snippets/emotion/relieved.json': emotion_relieved,
  './snippets/emotion/sad.json': emotion_sad,
  './snippets/emotion/skeptical.json': emotion_skeptical,
  './snippets/emotion/smirk.json': emotion_smirk,
  './snippets/emotion/stressed.json': emotion_stressed,
  './snippets/emotion/surprise.json': emotion_surprise,
  './snippets/emotion/wink.json': emotion_wink,
  './snippets/emotion/worried.json': emotion_worried,
};

export const speakingSnippets: Record<string, SnippetModule> = {
  './snippets/speaking/browFrownAndTilt.json': speaking_browFrownAndTilt,
  './snippets/speaking/browRaiseAndShortHeadNod.json': speaking_browRaiseAndShortHeadNod,
  './snippets/speaking/browRaiseLong.json': speaking_browRaiseLong,
  './snippets/speaking/browRaiseShort.json': speaking_browRaiseShort,
  './snippets/speaking/headNodBig.json': speaking_headNodBig,
  './snippets/speaking/headNodSmall.json': speaking_headNodSmall,
};

export const visemeSnippets: Record<string, SnippetModule> = {
  './snippets/visemes/lipsync_amazing.json': viseme_lipsync_amazing,
  './snippets/visemes/lipsync_anthropic.json': viseme_lipsync_anthropic,
  './snippets/visemes/lipsync_beautiful.json': viseme_lipsync_beautiful,
  './snippets/visemes/lipsync_good_morning.json': viseme_lipsync_good_morning,
  './snippets/visemes/lipsync_hello.json': viseme_lipsync_hello,
  './snippets/visemes/lipsync_hello_mumbled.json': viseme_lipsync_hello_mumbled,
  './snippets/visemes/lipsync_hello_precise.json': viseme_lipsync_hello_precise,
  './snippets/visemes/lipsync_hello_relaxed.json': viseme_lipsync_hello_relaxed,
  './snippets/visemes/lipsync_hello_theatrical.json': viseme_lipsync_hello_theatrical,
  './snippets/visemes/lipsync_hello_world.json': viseme_lipsync_hello_world,
  './snippets/visemes/lipsync_how_are_you.json': viseme_lipsync_how_are_you,
  './snippets/visemes/lipsync_speech.json': viseme_lipsync_speech,
  './snippets/visemes/lipsync_thank_you.json': viseme_lipsync_thank_you,
  './snippets/visemes/lipsync_world.json': viseme_lipsync_world,
  './snippets/visemes/phrase_viseme_snippet.json': viseme_phrase_viseme_snippet,
  './snippets/visemes/test1.json': viseme_test1,
};

export const eyeHeadTrackingSnippets: Record<string, SnippetModule> = {
  './snippets/eyeHeadTracking/eyePitch.json': eyeHeadTracking_eyePitch,
  './snippets/eyeHeadTracking/eyeRoll.json': eyeHeadTracking_eyeRoll,
  './snippets/eyeHeadTracking/eyeRollCircular.json': eyeHeadTracking_eyeRollCircular,
  './snippets/eyeHeadTracking/eyeYaw.json': eyeHeadTracking_eyeYaw,
  './snippets/eyeHeadTracking/headPitch.json': eyeHeadTracking_headPitch,
  './snippets/eyeHeadTracking/headRoll.json': eyeHeadTracking_headRoll,
  './snippets/eyeHeadTracking/headRollCircular.json': eyeHeadTracking_headRollCircular,
  './snippets/eyeHeadTracking/headYaw.json': eyeHeadTracking_headYaw,
};
