(ns latticework.runtime
  (:require [latticework.animation :as animation]
            [latticework.blink :as blink]
            [latticework.eye-head-tracking :as eye-head-tracking]
            [latticework.gaze :as gaze]
            [latticework.hair :as hair]
            [latticework.lipsync :as lipsync]
            [latticework.prosodic :as prosodic]
            [latticework.protocol :as protocol]
            [latticework.vocal :as vocal]))

(defn- fn-prop [value key]
  (let [candidate (and value (aget value key))]
    (when (fn? candidate) candidate)))

(defn- emit-callback! [host output]
  (when-let [on-output (fn-prop host "onOutput")]
    (on-output (protocol/data->js output))))

(defn- emit-state! [host state]
  (when-let [on-state (fn-prop host "onState")]
    (on-state (protocol/data->js state))))

(defn- call-first! [host names & args]
  (loop [remaining names]
    (when-let [name (first remaining)]
      (if-let [callback (fn-prop host name)]
        (do (apply callback args) true)
        (recur (rest remaining))))))

(defn- apply-animation-effect! [host effect]
  (when-let [on-animation-effect (fn-prop host "onAnimationEffect")]
    (on-animation-effect (protocol/data->js effect)))
  (case (:op effect)
    "scheduleSnippet"
    (call-first! host
                 ["scheduleSnippet" "schedule"]
                 (protocol/data->js (:snippet effect))
                 (protocol/data->js (:opts effect)))

    "updateSnippet"
    (call-first! host
                 ["updateSnippet"]
                 (protocol/data->js (:snippet effect)))

    "removeSnippet"
    (call-first! host ["removeSnippet" "remove"] (:name effect))

    "seekSnippet"
    (call-first! host ["seekSnippet" "seek"] (:name effect) (:offsetSec effect))

    "pauseSnippet"
    (call-first! host ["pauseSnippet"] (:name effect))

    "resumeSnippet"
    (call-first! host ["resumeSnippet"] (:name effect))

    "restartSnippet"
    (call-first! host ["restartSnippet"] (:name effect))

    "playAll"
    (call-first! host ["play"])

    "pauseAll"
    (call-first! host ["pause"])

    "stopAll"
    (call-first! host ["stop"])

    "setSnippetPlaybackRate"
    (call-first! host ["setSnippetPlaybackRate"] (:name effect) (:playbackRate effect))

    "setSnippetIntensityScale"
    (call-first! host ["setSnippetIntensityScale"] (:name effect) (:intensityScale effect))

    "setSnippetLoopMode"
    (call-first! host ["setSnippetLoopMode"] (:name effect) (:mixerLoopMode effect))

    "setSnippetReverse"
    (call-first! host ["setSnippetReverse"] (:name effect) (:reverse effect))

    nil))

(defn- schedule-cleanup! [host scheduled-name snippet]
  (when (and scheduled-name
             (not (:mixerClampWhenFinished snippet))
             (fn-prop host "removeSnippet"))
    (let [duration-ms (+ (* (or (:maxTime snippet) 0) 1000) 50)]
      (js/setTimeout
       (fn []
         (when-let [remove-snippet (fn-prop host "removeSnippet")]
           (remove-snippet scheduled-name)))
       duration-ms))))

(defn apply-output! [host output]
  (emit-callback! host output)
  (case (:type output)
    "state"
    (emit-state! host (:state output))

    "scheduleSnippet"
    (let [snippet (:snippet output)
          options (:options output)
          scheduled-name (or
                          (when-let [schedule-snippet (fn-prop host "scheduleSnippet")]
                            (schedule-snippet
                             (protocol/data->js snippet)
                             (protocol/data->js options)))
                          (when-let [schedule (fn-prop host "schedule")]
                            (schedule
                             (protocol/data->js snippet)
                             (protocol/data->js options))))]
      (schedule-cleanup! host scheduled-name snippet))

    "removeSnippet"
    (call-first! host ["removeSnippet" "remove"] (:name output))

    "animationEffect"
    (apply-animation-effect! host (:effect output))

    "animationEvent"
    (when-let [on-animation-event (fn-prop host "onAnimationEvent")]
      (on-animation-event (protocol/data->js (:event output))))

    "prosodicEvent"
    (when-let [on-prosodic-event (fn-prop host "onProsodicEvent")]
      (on-prosodic-event (protocol/data->js (:event output))))

    "prosodicFadePlan"
    (let [plan (:plan output)]
      (when-let [on-prosodic-fade-plan (fn-prop host "onProsodicFadePlan")]
        (on-prosodic-fade-plan (protocol/data->js plan)))
      (when-not (fn-prop host "onProsodicFadePlan")
        (doseq [step (:steps plan)]
          (js/setTimeout
           (fn []
             (call-first! host ["setSnippetIntensityScale"] (:name step) (:intensity step))
             (when (:removeOnComplete step)
               (call-first! host ["removeSnippet" "remove"] (:name step))))
           (:delayMs step)))))

    "vocalEvent"
    (when-let [on-vocal-event (fn-prop host "onVocalEvent")]
      (on-vocal-event (protocol/data->js (:event output))))

    "vocalCleanupPlan"
    (when-let [on-vocal-cleanup-plan (fn-prop host "onVocalCleanupPlan")]
      (on-vocal-cleanup-plan (protocol/data->js (:plan output))))

    "lipsyncEvent"
    (when-let [on-lipsync-event (fn-prop host "onLipSyncEvent")]
      (on-lipsync-event (protocol/data->js (:event output))))

    "lipsyncCleanupPlan"
    (when-let [on-lipsync-cleanup-plan (fn-prop host "onLipSyncCleanupPlan")]
      (on-lipsync-cleanup-plan (protocol/data->js (:plan output))))

    "applyHairState"
    (if-let [apply-hair-state (fn-prop host "applyHairState")]
      (apply-hair-state
       (protocol/data->js (:state output))
       (protocol/data->js (:objects output))
       (protocol/data->js (:objectStates output)))
      (when-let [apply-object-state (fn-prop host "applyHairStateToObject")]
        (doseq [{:keys [name objectState]} (:objectStates output)]
          (apply-object-state name (protocol/data->js objectState)))))

    "applyHairPhysics"
    (if-let [apply-hair-physics (fn-prop host "applyHairPhysics")]
      (apply-hair-physics
       (:enabled output)
       (protocol/data->js (:config output)))
      (do
        (when-let [set-physics-config (fn-prop host "setHairPhysicsConfig")]
          (set-physics-config (protocol/data->js (:config output))))
        (when-let [set-physics-enabled (fn-prop host "setHairPhysicsEnabled")]
          (set-physics-enabled (:enabled output)))))

    "error"
    (if-let [on-error (fn-prop host "onError")]
      (on-error (protocol/data->js output))
      (.warn js/console (:message output)))

    nil))

(defn apply-outputs! [host outputs]
  (doseq [output outputs]
    (apply-output! host output)))

(defn create-in-process-blink-agency
  ([config] (create-in-process-blink-agency config nil))
  ([config host]
   (let [state (blink/create-state (protocol/js->data config))
         host (or host #js {})
         auto-timer (atom nil)
         disposed (atom false)
         clear-auto! (fn []
                       (when-let [timer @auto-timer]
                         (js/clearTimeout timer)
                         (reset! auto-timer nil)))]
     (letfn [(emit! [outputs]
               (when-not @disposed
                 (apply-outputs! host outputs)))
             (schedule-next-auto! []
               (clear-auto!)
               (when (and (not @disposed) (:enabled @state))
                 (when-let [interval (blink/auto-interval-ms (blink/snapshot state))]
                   (reset! auto-timer
                           (js/setTimeout
                            (fn []
                              (reset! auto-timer nil)
                              (when (and (not @disposed) (:enabled @state))
                                (emit! (blink/trigger-blink! state nil))
                                (schedule-next-auto!)))
                            interval)))))
             (sync-auto! []
               (if (and (not @disposed) (:enabled @state))
                 (schedule-next-auto!)
                 (clear-auto!)))]
       (emit! [(protocol/emit-state blink/agency-name (blink/snapshot state))])
       (sync-auto!)
       #js {:configure (fn [next-config]
                         (emit! (blink/configure! state (protocol/js->data next-config)))
                         (sync-auto!))
            :enable (fn []
                      (emit! (blink/enable! state))
                      (sync-auto!))
            :disable (fn []
                       (emit! (blink/disable! state))
                       (sync-auto!))
            :setFrequency (fn [frequency]
                            (emit! (blink/set-frequency! state frequency))
                            (sync-auto!))
            :setDuration (fn [duration]
                           (emit! (blink/set-duration! state duration)))
            :setIntensity (fn [intensity]
                            (emit! (blink/set-intensity! state intensity)))
            :setRandomness (fn [randomness]
                             (emit! (blink/set-randomness! state randomness))
                             (sync-auto!))
            :triggerBlink (fn
                            ([] (emit! (blink/trigger-blink! state nil)))
                            ([overrides] (emit! (blink/trigger-blink! state (protocol/js->data overrides)))))
            :reset (fn []
                     (emit! (blink/reset-state! state))
                     (sync-auto!))
            :getState (fn []
                        (protocol/data->js (blink/snapshot state)))
            :dispose (fn []
                       (reset! disposed true)
                       (clear-auto!))}))))

(defn create-in-process-gaze-agency
  ([config] (create-in-process-gaze-agency config nil))
  ([config host]
   (let [state (gaze/create-state (protocol/js->data config))
         host (or host #js {})
         disposed (atom false)]
     (letfn [(emit! [outputs]
               (when-not @disposed
                 (apply-outputs! host outputs))
               outputs)
             (schedule! [target]
               (let [outputs (emit! (gaze/schedule-target! state (protocol/js->data target)))]
                 (boolean (some #(= "scheduleSnippet" (:type %)) outputs))))]
       (emit! [(protocol/emit-state gaze/agency-name (gaze/snapshot state))])
       #js {:configure (fn [next-config]
                         (emit! (gaze/configure! state (protocol/js->data next-config))))
            :updateConfig (fn [next-config]
                            (emit! (gaze/configure! state (protocol/js->data next-config))))
            :setMode (fn [mode]
                       (emit! (gaze/set-mode! state mode)))
            :setTarget (fn [target]
                         (schedule! target))
            :schedule (fn [target]
                        (schedule! target))
            :resetToNeutral (fn
                              ([] (emit! (gaze/reset-to-neutral! state nil)))
                              ([duration] (emit! (gaze/reset-to-neutral! state duration))))
            :stop (fn []
                    (emit! (gaze/stop! state)))
            :getState (fn []
                        (protocol/data->js (gaze/snapshot state)))
            :dispose (fn []
                       (emit! (gaze/stop! state))
                       (reset! disposed true))}))))

(defn create-in-process-eye-head-tracking-agency
  ([config] (create-in-process-eye-head-tracking-agency config nil))
  ([config host]
   (let [state (eye-head-tracking/create-state (protocol/js->data config))
         host (or host #js {})
         disposed (atom false)]
     (letfn [(emit! [outputs]
               (when-not @disposed
                 (apply-outputs! host outputs))
               outputs)
             (schedule! [target]
               (let [outputs (emit! (eye-head-tracking/schedule-target! state (protocol/js->data target)))]
                 (boolean (some #(= "scheduleSnippet" (:type %)) outputs))))]
       (emit! [(protocol/emit-state eye-head-tracking/agency-name (eye-head-tracking/eye-head-state state))])
       #js {:configure (fn [next-config]
                         (emit! (eye-head-tracking/configure! state (protocol/js->data next-config))))
            :updateConfig (fn [next-config]
                            (emit! (eye-head-tracking/configure! state (protocol/js->data next-config))))
            :start (fn []
                     (emit! (eye-head-tracking/start! state)))
            :setMode (fn [mode]
                       (emit! (eye-head-tracking/set-mode! state mode)))
            :getMode (fn []
                       (:mode (eye-head-tracking/snapshot state)))
            :setGazeTarget (fn [target]
                             (schedule! target))
            :setTarget (fn [target]
                         (schedule! target))
            :schedule (fn [target]
                        (schedule! target))
            :resetToNeutral (fn
                              ([] (emit! (eye-head-tracking/reset-to-neutral! state nil)))
                              ([duration] (emit! (eye-head-tracking/reset-to-neutral! state duration))))
            :pause (fn []
                     (emit! (eye-head-tracking/pause! state)))
            :resume (fn []
                      (emit! (eye-head-tracking/resume! state)))
            :stop (fn []
                    (emit! (eye-head-tracking/stop! state)))
            :getState (fn []
                        (protocol/data->js (eye-head-tracking/eye-head-state state)))
            :getSnapshot (fn []
                           (protocol/data->js (eye-head-tracking/snapshot state)))
            :dispose (fn []
                       (emit! (eye-head-tracking/stop! state))
                       (reset! disposed true))}))))

(defn create-in-process-animation-agency
  ([config] (create-in-process-animation-agency config nil))
  ([config host]
   (let [state (animation/create-state (protocol/js->data config))
         host (or host #js {})
         disposed (atom false)]
     (letfn [(emit! [command-result]
               (let [outputs (:outputs command-result)]
                 (when-not @disposed
                   (apply-outputs! host outputs))
                 command-result))]
       (apply-outputs! host [(protocol/emit-state animation/agency-name (animation/snapshot state))])
       #js {:loadFromJSON (fn [data]
                            (:result (emit! (animation/load! state (protocol/js->data data)))))
            :schedule (fn
                        ([snippet] (:result (emit! (animation/schedule! state (protocol/js->data snippet) nil))))
                        ([snippet opts] (:result (emit! (animation/schedule! state
                                                                             (protocol/js->data snippet)
                                                                             (protocol/js->data opts))))))
            :updateSnippet (fn [snippet]
                             (:result (emit! (animation/update-snippet! state (protocol/js->data snippet)))))
            :remove (fn [name]
                      (:result (emit! (animation/remove! state name))))
            :play (fn []
                    (:result (emit! (animation/play! state))))
            :pause (fn []
                     (:result (emit! (animation/pause! state))))
            :stop (fn []
                    (:result (emit! (animation/stop! state))))
            :enable (fn
                      ([name] (:result (emit! (animation/enable! state name true))))
                      ([name on] (:result (emit! (animation/enable! state name on)))))
            :seek (fn [name offset-sec]
                    (:result (emit! (animation/seek! state name offset-sec))))
            :setSnippetPlaying (fn [name is-playing]
                                  (:result (emit! (animation/set-playing! state name is-playing))))
            :setSnippetTime (fn [name time]
                              (:result (emit! (animation/seek! state name time))))
            :setSnippetPlaybackRate (fn [name rate]
                                      (:result (emit! (animation/set-playback-rate! state name rate))))
            :setSnippetIntensityScale (fn [name scale]
                                        (:result (emit! (animation/set-intensity-scale! state name scale))))
            :setSnippetLoopMode (fn [name mode]
                                  (:result (emit! (animation/set-loop-mode! state name mode))))
            :setSnippetReverse (fn [name reverse]
                                 (:result (emit! (animation/set-reverse! state name reverse))))
            :getState (fn []
                        (protocol/data->js (animation/snapshot state)))
            :getScheduleSnapshot (fn []
                                   (protocol/data->js (animation/schedule-snapshot state)))
            :dispose (fn []
                       (reset! disposed true))}))))

(defn create-in-process-prosodic-agency
  ([config] (create-in-process-prosodic-agency config nil))
  ([config host]
   (let [state (prosodic/create-state (protocol/js->data config))
         host (or host #js {})
         disposed (atom false)]
     (letfn [(emit! [outputs]
               (when-not @disposed
                 (apply-outputs! host outputs))
               outputs)]
       (emit! [(protocol/emit-state prosodic/agency-name (prosodic/snapshot state))])
       #js {:loadBrow (fn [data]
                        (emit! (prosodic/load-brow! state (protocol/js->data data))))
            :loadHead (fn [data]
                        (emit! (prosodic/load-head! state (protocol/js->data data))))
            :updateConfig (fn [config]
                            (emit! (prosodic/update-config! state (protocol/js->data config))))
            :startTalking (fn []
                            (emit! (prosodic/start-talking! state)))
            :stopTalking (fn []
                           (emit! (prosodic/stop-talking! state)))
            :pulse (fn [word-index]
                     (emit! (prosodic/pulse! state word-index)))
            :stop (fn []
                    (emit! (prosodic/stop! state)))
            :getState (fn []
                        (protocol/data->js (prosodic/prosodic-state state)))
            :getSnapshot (fn []
                           (protocol/data->js (prosodic/snapshot state)))
            :dispose (fn []
                       (emit! (prosodic/stop! state))
                       (reset! disposed true))}))))

(defn create-in-process-vocal-agency
  ([config] (create-in-process-vocal-agency config nil))
  ([config host]
   (let [state (vocal/create-state (protocol/js->data config))
         host (or host #js {})
         disposed (atom false)
         cleanup-timers (atom {})]
     (letfn [(clear-cleanup! [name]
               (when-let [timer (get @cleanup-timers name)]
                 (js/clearTimeout timer)
                 (swap! cleanup-timers dissoc name)))
             (clear-all-cleanups! []
               (doseq [timer (vals @cleanup-timers)]
                 (js/clearTimeout timer))
               (reset! cleanup-timers {}))
             (schedule-cleanup! [plan]
               (let [name (:name plan)]
                 (when name
                   (clear-cleanup! name)
                   (swap! cleanup-timers
                          assoc
                          name
                          (js/setTimeout
                           (fn []
                             (clear-cleanup! name)
                             (when-not @disposed
                               (emit! (vocal/cleanup! state name))))
                           (max 0 (:delayMs plan)))))))
             (sync-timers! [outputs]
               (doseq [output outputs]
                 (case (:type output)
                   "vocalCleanupPlan" (schedule-cleanup! (:plan output))
                   "removeSnippet" (clear-cleanup! (:name output))
                   nil)))
             (emit! [command-result]
               (let [outputs (:outputs command-result)]
                 (sync-timers! outputs)
                 (when-not @disposed
                   (apply-outputs! host outputs))
                 command-result))]
       (apply-outputs! host [(protocol/emit-state vocal/agency-name (vocal/snapshot state))])
       #js {:updateConfig (fn [config]
                            (:result (emit! (vocal/update-config! state (protocol/js->data config)))))
            :startTimeline (fn [timeline]
                             (:result (emit! (vocal/start-timeline! state (protocol/js->data timeline)))))
            :startSentence (fn [text]
                             (:result (emit! (vocal/start-sentence! state text))))
            :onWordBoundary (fn
                              ([word] (:result (emit! (vocal/on-word-boundary! state word nil nil))))
                              ([word word-index] (:result (emit! (vocal/on-word-boundary! state word word-index nil))))
                              ([word word-index observed-elapsed-sec]
                               (:result (emit! (vocal/on-word-boundary! state word word-index observed-elapsed-sec)))))
            :updateWordTimings (fn [word-timings]
                                 (:result (emit! (vocal/update-word-timings! state (protocol/js->data word-timings)))))
            :stopSentence (fn []
                            (:result (emit! (vocal/stop-sentence! state))))
            :pauseSentence (fn []
                             (:result (emit! (vocal/pause-sentence! state))))
            :resumeSentence (fn []
                              (:result (emit! (vocal/resume-sentence! state))))
            :speak (fn [text]
                     (:result (emit! (vocal/start-sentence! state text))))
            :speakWord (fn [word]
                         (:result (emit! (vocal/speak-word! state word))))
            :processWordBoundary (fn [timing]
                                   (:result (emit! (vocal/process-word-boundary! state (protocol/js->data timing)))))
            :processVisemeEvents (fn
                                   ([events] (:result (emit! (vocal/process-viseme-events! state (protocol/js->data events) nil))))
                                   ([events name] (:result (emit! (vocal/process-viseme-events! state (protocol/js->data events) name)))))
            :stop (fn []
                    (:result (emit! (vocal/stop! state))))
            :getState (fn []
                        (protocol/data->js (vocal/vocal-state state)))
            :getSnapshot (fn []
                           (protocol/data->js (vocal/snapshot state)))
            :dispose (fn []
                       (emit! (vocal/stop! state))
                       (clear-all-cleanups!)
                       (reset! disposed true))}))))

(defn create-in-process-lipsync-agency
  ([config] (create-in-process-lipsync-agency config nil))
  ([config host]
   (let [state (lipsync/create-state (protocol/js->data config))
         host (or host #js {})
         disposed (atom false)
         cleanup-timers (atom {})]
     (letfn [(clear-cleanup! [name]
               (when-let [timer (get @cleanup-timers name)]
                 (js/clearTimeout timer)
                 (swap! cleanup-timers dissoc name)))
             (clear-all-cleanups! []
               (doseq [timer (vals @cleanup-timers)]
                 (js/clearTimeout timer))
               (reset! cleanup-timers {}))
             (schedule-cleanup! [plan]
               (let [name (:name plan)]
                 (when name
                   (clear-cleanup! name)
                   (swap! cleanup-timers
                          assoc
                          name
                          (js/setTimeout
                           (fn []
                             (clear-cleanup! name)
                             (when-not @disposed
                               (emit! (lipsync/cleanup! state name))))
                           (max 0 (:delayMs plan)))))))
             (sync-timers! [outputs]
               (doseq [output outputs]
                 (case (:type output)
                   "lipsyncCleanupPlan" (schedule-cleanup! (:plan output))
                   "removeSnippet" (clear-cleanup! (:name output))
                   nil)))
             (emit! [command-result]
               (let [outputs (:outputs command-result)]
                 (sync-timers! outputs)
                 (when-not @disposed
                   (apply-outputs! host outputs))
                 command-result))]
       (apply-outputs! host [(protocol/emit-state lipsync/agency-name (lipsync/snapshot state))])
       #js {:startSpeech (fn []
                           (:result (emit! (lipsync/start-speech! state))))
            :processWord (fn
                           ([word word-index]
                            (:result (emit! (lipsync/process-word! state word word-index nil nil))))
                           ([word word-index actual-duration-ms]
                            (:result (emit! (lipsync/process-word! state word word-index actual-duration-ms nil)))))
            :processAzureVisemes (fn
                                   ([events] (:result (emit! (lipsync/process-azure-visemes! state (protocol/js->data events) nil nil))))
                                   ([events total-duration-ms]
                                    (:result (emit! (lipsync/process-azure-visemes! state (protocol/js->data events) total-duration-ms nil)))))
            :endSpeech (fn []
                         (:result (emit! (lipsync/end-speech! state))))
            :stop (fn []
                    (:result (emit! (lipsync/stop! state))))
            :updateConfig (fn [config]
                            (:result (emit! (lipsync/update-config! state (protocol/js->data config)))))
            :getState (fn []
                        (protocol/data->js (lipsync/lipsync-state state)))
            :getSnapshot (fn []
                           (protocol/data->js (lipsync/snapshot state)))
            :dispose (fn []
                       (emit! (lipsync/stop! state))
                       (clear-all-cleanups!)
                       (reset! disposed true))}))))

(defn create-in-process-hair-agency
  ([config] (create-in-process-hair-agency config nil))
  ([config host]
   (let [state (hair/create-state (protocol/js->data config))
         host (or host #js {})
         disposed (atom false)]
     (letfn [(emit! [outputs]
               (when-not @disposed
                 (apply-outputs! host outputs))
               outputs)]
       (emit! [(protocol/emit-state hair/agency-name (hair/snapshot state))])
       #js {:configure (fn [next-config]
                         (emit! (hair/configure! state (protocol/js->data next-config))))
            :registerObjects (fn [objects]
                               (emit! (hair/register-objects! state (protocol/js->data objects))))
            :send (fn [event]
                    (emit! (hair/handle-command!
                            state
                            {:type "send" :event (protocol/js->data event)})))
            :setHairColor (fn [color]
                            (emit! (hair/set-hair-color! state (protocol/js->data color))))
            :setEyebrowColor (fn [color]
                               (emit! (hair/set-eyebrow-color! state (protocol/js->data color))))
            :setHairBaseColor (fn [base-color]
                                (emit! (hair/set-hair-base-color! state base-color)))
            :setEyebrowBaseColor (fn [base-color]
                                   (emit! (hair/set-eyebrow-base-color! state base-color)))
            :setHairGlow (fn [emissive intensity]
                           (emit! (hair/set-hair-glow! state emissive intensity)))
            :setEyebrowGlow (fn [emissive intensity]
                              (emit! (hair/set-eyebrow-glow! state emissive intensity)))
            :setOutline (fn
                          ([show] (emit! (hair/set-outline! state show nil nil)))
                          ([show color] (emit! (hair/set-outline! state show color nil)))
                          ([show color opacity] (emit! (hair/set-outline! state show color opacity))))
            :setPartVisibility (fn [part-name visible]
                                  (emit! (hair/set-part-visibility! state part-name visible)))
            :setPartScale (fn [part-name scale]
                            (emit! (hair/set-part-scale! state part-name scale)))
            :setPartPosition (fn [part-name position]
                               (emit! (hair/set-part-position! state part-name (protocol/js->data position))))
            :resetToDefault (fn []
                              (emit! (hair/reset-to-default! state)))
            :setPhysicsEnabled (fn [enabled]
                                  (emit! (hair/set-physics-enabled! state enabled)))
            :updatePhysicsConfig (fn [config]
                                   (emit! (hair/update-physics-config! state (protocol/js->data config))))
            :getState (fn []
                        (protocol/data->js (hair/snapshot state)))
            :getHairState (fn []
                            (protocol/data->js (hair/hair-snapshot state)))
            :getPhysicsConfig (fn []
                                (protocol/data->js
                                 (assoc (get-in (hair/snapshot state) [:physics :config])
                                        :enabled (get-in (hair/snapshot state) [:physics :enabled]))))
            :dispose (fn []
                       (reset! disposed true))}))))

(defn create-worker-client [worker host]
  (let [host (or host #js {})
        disposed (atom false)
        handler (fn [event]
                  (when-not @disposed
                    (apply-output! host (protocol/js->data (.-data event)))))]
    (.addEventListener worker "message" handler)
    #js {:post (fn [command]
                 (when-not @disposed
                   (.postMessage worker command)))
         :configure (fn [agency config]
                      (when-not @disposed
                        (.postMessage worker #js {:agency agency
                                                  :type "configure"
                                                  :config config})))
         :dispose (fn []
                    (reset! disposed true)
                    (.removeEventListener worker "message" handler))}))

(defn create-animation-worker-client [worker host]
  (let [client (create-worker-client worker host)]
    #js {:loadFromJSON (fn [data]
                         (.post client #js {:agency "animation" :type "loadFromJSON" :data data}))
         :schedule (fn
                     ([snippet] (.post client #js {:agency "animation" :type "schedule" :snippet snippet}))
                     ([snippet opts] (.post client #js {:agency "animation" :type "schedule" :snippet snippet :opts opts})))
         :updateSnippet (fn [snippet]
                          (.post client #js {:agency "animation" :type "updateSnippet" :snippet snippet}))
         :remove (fn [name]
                   (.post client #js {:agency "animation" :type "remove" :name name}))
         :play (fn []
                 (.post client #js {:agency "animation" :type "play"}))
         :pause (fn []
                  (.post client #js {:agency "animation" :type "pause"}))
         :stop (fn []
                 (.post client #js {:agency "animation" :type "stop"}))
         :enable (fn
                   ([name] (.post client #js {:agency "animation" :type "enable" :name name :on true}))
                   ([name on] (.post client #js {:agency "animation" :type "enable" :name name :on on})))
         :seek (fn [name offset-sec]
                 (.post client #js {:agency "animation" :type "seek" :name name :offsetSec offset-sec}))
         :setSnippetPlaying (fn [name is-playing]
                               (.post client #js {:agency "animation" :type "setSnippetPlaying" :name name :isPlaying is-playing}))
         :setSnippetTime (fn [name time]
                           (.post client #js {:agency "animation" :type "setSnippetTime" :name name :time time}))
         :setSnippetPlaybackRate (fn [name rate]
                                   (.post client #js {:agency "animation" :type "setSnippetPlaybackRate" :name name :rate rate}))
         :setSnippetIntensityScale (fn [name scale]
                                     (.post client #js {:agency "animation" :type "setSnippetIntensityScale" :name name :scale scale}))
         :setSnippetLoopMode (fn [name mode]
                               (.post client #js {:agency "animation" :type "setSnippetLoopMode" :name name :mode mode}))
         :setSnippetReverse (fn [name reverse]
                              (.post client #js {:agency "animation" :type "setSnippetReverse" :name name :reverse reverse}))
         :dispose (fn []
                    (.dispose client))}))

(defn create-blink-worker-client [worker host]
  (let [client (create-worker-client worker host)]
    #js {:configure (fn [config]
                      (.configure client blink/agency-name config))
         :enable (fn []
                   (.post client #js {:agency "blink" :type "enable"}))
         :disable (fn []
                    (.post client #js {:agency "blink" :type "disable"}))
         :setFrequency (fn [frequency]
                         (.post client #js {:agency "blink" :type "setFrequency" :frequency frequency}))
         :setDuration (fn [duration]
                        (.post client #js {:agency "blink" :type "setDuration" :duration duration}))
         :setIntensity (fn [intensity]
                         (.post client #js {:agency "blink" :type "setIntensity" :intensity intensity}))
         :setRandomness (fn [randomness]
                          (.post client #js {:agency "blink" :type "setRandomness" :randomness randomness}))
         :triggerBlink (fn
                         ([] (.post client #js {:agency "blink" :type "triggerBlink"}))
                         ([overrides]
                          (let [command (js/Object.assign #js {:agency "blink" :type "triggerBlink"} overrides)]
                            (.post client command))))
         :reset (fn []
                  (.post client #js {:agency "blink" :type "reset"}))
         :dispose (fn []
                    (.dispose client))}))

(defn create-prosodic-worker-client [worker host]
  (let [client (create-worker-client worker host)]
    #js {:loadBrow (fn [data]
                     (.post client #js {:agency "prosodic" :type "loadBrow" :data data}))
         :loadHead (fn [data]
                     (.post client #js {:agency "prosodic" :type "loadHead" :data data}))
         :updateConfig (fn [config]
                         (.post client #js {:agency "prosodic" :type "updateConfig" :config config}))
         :startTalking (fn []
                         (.post client #js {:agency "prosodic" :type "startTalking"}))
         :stopTalking (fn []
                        (.post client #js {:agency "prosodic" :type "stopTalking"}))
         :pulse (fn [word-index]
                  (.post client #js {:agency "prosodic" :type "pulse" :wordIndex word-index}))
         :stop (fn []
                 (.post client #js {:agency "prosodic" :type "stop"}))
         :dispose (fn []
                    (.dispose client))}))

(defn create-vocal-worker-client [worker host]
  (let [host (or host #js {})
        cleanup-timers (atom {})
        client-ref (atom nil)
        clear-cleanup! (fn [name]
                         (when-let [timer (get @cleanup-timers name)]
                           (js/clearTimeout timer)
                           (swap! cleanup-timers dissoc name)))
        clear-all-cleanups! (fn []
                              (doseq [timer (vals @cleanup-timers)]
                                (js/clearTimeout timer))
                              (reset! cleanup-timers {}))
        wrapped-host (js/Object.assign
                      #js {}
                      host
                      #js {:onVocalCleanupPlan
                           (fn [plan]
                             (when-let [on-vocal-cleanup-plan (fn-prop host "onVocalCleanupPlan")]
                               (on-vocal-cleanup-plan plan))
                             (let [name (aget plan "name")
                                   delay-ms (or (aget plan "delayMs") 0)]
                               (when name
                                 (clear-cleanup! name)
                                 (swap! cleanup-timers
                                        assoc
                                        name
                                        (js/setTimeout
                                         (fn []
                                           (clear-cleanup! name)
                                           (when-let [client @client-ref]
                                             (.post ^js client #js {:agency "vocal" :type "cleanup" :name name})))
                                         (max 0 delay-ms))))))})
        client (create-worker-client worker wrapped-host)]
    (reset! client-ref client)
    #js {:updateConfig (fn [config]
                         (.post client #js {:agency "vocal" :type "updateConfig" :config config}))
         :startTimeline (fn [timeline]
                          (.post client #js {:agency "vocal" :type "startTimeline" :timeline timeline}))
         :startSentence (fn [text]
                          (.post client #js {:agency "vocal" :type "startSentence" :text text}))
         :onWordBoundary (fn
                           ([word] (.post client #js {:agency "vocal" :type "onWordBoundary" :word word}))
                           ([word word-index]
                            (.post client #js {:agency "vocal" :type "onWordBoundary" :word word :wordIndex word-index}))
                           ([word word-index observed-elapsed-sec]
                            (.post client #js {:agency "vocal" :type "onWordBoundary" :word word :wordIndex word-index :observedElapsedSec observed-elapsed-sec})))
         :updateWordTimings (fn [word-timings]
                              (.post client #js {:agency "vocal" :type "updateWordTimings" :wordTimings word-timings}))
         :stopSentence (fn []
                         (.post client #js {:agency "vocal" :type "stopSentence"}))
         :pauseSentence (fn []
                          (.post client #js {:agency "vocal" :type "pauseSentence"}))
         :resumeSentence (fn []
                           (.post client #js {:agency "vocal" :type "resumeSentence"}))
         :speak (fn [text]
                  (.post client #js {:agency "vocal" :type "speak" :text text}))
         :speakWord (fn [word]
                      (.post client #js {:agency "vocal" :type "speakWord" :word word}))
         :processWordBoundary (fn [timing]
                                (.post client #js {:agency "vocal" :type "processWordBoundary" :timing timing}))
         :processVisemeEvents (fn
                                ([events] (.post client #js {:agency "vocal" :type "processVisemeEvents" :events events}))
                                ([events name] (.post client #js {:agency "vocal" :type "processVisemeEvents" :events events :name name})))
         :stop (fn []
                 (.post client #js {:agency "vocal" :type "stop"}))
         :dispose (fn []
                    (clear-all-cleanups!)
                    (.dispose client))}))

(defn create-lipsync-worker-client [worker host]
  (let [host (or host #js {})
        cleanup-timers (atom {})
        client-ref (atom nil)
        clear-cleanup! (fn [name]
                         (when-let [timer (get @cleanup-timers name)]
                           (js/clearTimeout timer)
                           (swap! cleanup-timers dissoc name)))
        clear-all-cleanups! (fn []
                              (doseq [timer (vals @cleanup-timers)]
                                (js/clearTimeout timer))
                              (reset! cleanup-timers {}))
        wrapped-host (js/Object.assign
                      #js {}
                      host
                      #js {:onLipSyncCleanupPlan
                           (fn [plan]
                             (when-let [on-lipsync-cleanup-plan (fn-prop host "onLipSyncCleanupPlan")]
                               (on-lipsync-cleanup-plan plan))
                             (let [name (aget plan "name")
                                   delay-ms (or (aget plan "delayMs") 0)]
                               (when name
                                 (clear-cleanup! name)
                                 (swap! cleanup-timers
                                        assoc
                                        name
                                        (js/setTimeout
                                         (fn []
                                           (clear-cleanup! name)
                                           (when-let [client @client-ref]
                                             (.post ^js client #js {:agency "lipsync" :type "cleanup" :name name})))
                                         (max 0 delay-ms))))))})
        client (create-worker-client worker wrapped-host)]
    (reset! client-ref client)
    #js {:startSpeech (fn []
                        (.post client #js {:agency "lipsync" :type "startSpeech"}))
         :processWord (fn
                        ([word word-index]
                         (.post client #js {:agency "lipsync" :type "processWord" :word word :wordIndex word-index}))
                        ([word word-index actual-duration-ms]
                         (.post client #js {:agency "lipsync" :type "processWord" :word word :wordIndex word-index :actualDurationMs actual-duration-ms})))
         :processAzureVisemes (fn
                                ([events] (.post client #js {:agency "lipsync" :type "processAzureVisemes" :events events}))
                                ([events total-duration-ms]
                                 (.post client #js {:agency "lipsync" :type "processAzureVisemes" :events events :totalDurationMs total-duration-ms})))
         :endSpeech (fn []
                      (.post client #js {:agency "lipsync" :type "endSpeech"}))
         :stop (fn []
                 (.post client #js {:agency "lipsync" :type "stop"}))
         :updateConfig (fn [config]
                         (.post client #js {:agency "lipsync" :type "updateConfig" :config config}))
         :dispose (fn []
                    (clear-all-cleanups!)
                    (.dispose client))}))

(defn create-hair-worker-client [worker host]
  (let [client (create-worker-client worker host)]
    #js {:configure (fn [config]
                      (.configure client hair/agency-name config))
         :registerObjects (fn [objects]
                            (.post client #js {:agency "hair" :type "registerObjects" :objects objects}))
         :send (fn [event]
                 (.post client #js {:agency "hair" :type "send" :event event}))
         :setHairColor (fn [color]
                         (.post client #js {:agency "hair" :type "setHairColor" :color color}))
         :setEyebrowColor (fn [color]
                            (.post client #js {:agency "hair" :type "setEyebrowColor" :color color}))
         :setHairBaseColor (fn [base-color]
                             (.post client #js {:agency "hair" :type "setHairBaseColor" :baseColor base-color}))
         :setEyebrowBaseColor (fn [base-color]
                                (.post client #js {:agency "hair" :type "setEyebrowBaseColor" :baseColor base-color}))
         :setHairGlow (fn [emissive intensity]
                        (.post client #js {:agency "hair" :type "setHairGlow" :emissive emissive :intensity intensity}))
         :setEyebrowGlow (fn [emissive intensity]
                           (.post client #js {:agency "hair" :type "setEyebrowGlow" :emissive emissive :intensity intensity}))
         :setOutline (fn
                       ([show] (.post client #js {:agency "hair" :type "setOutline" :show show}))
                       ([show color] (.post client #js {:agency "hair" :type "setOutline" :show show :color color}))
                       ([show color opacity]
                        (.post client #js {:agency "hair" :type "setOutline" :show show :color color :opacity opacity})))
         :setPartVisibility (fn [part-name visible]
                              (.post client #js {:agency "hair" :type "setPartVisibility" :partName part-name :visible visible}))
         :setPartScale (fn [part-name scale]
                         (.post client #js {:agency "hair" :type "setPartScale" :partName part-name :scale scale}))
         :setPartPosition (fn [part-name position]
                            (.post client #js {:agency "hair" :type "setPartPosition" :partName part-name :position position}))
         :resetToDefault (fn []
                           (.post client #js {:agency "hair" :type "resetToDefault"}))
         :setPhysicsEnabled (fn [enabled]
                              (.post client #js {:agency "hair" :type "setPhysicsEnabled" :enabled enabled}))
         :updatePhysicsConfig (fn [config]
                                (.post client #js {:agency "hair" :type "updatePhysicsConfig" :config config}))
         :dispose (fn []
                    (.dispose client))}))

(defn create-eye-head-tracking-worker-client [worker host]
  (let [client (create-worker-client worker host)]
    #js {:configure (fn [config]
                      (.configure client eye-head-tracking/agency-name config))
         :updateConfig (fn [config]
                         (.configure client eye-head-tracking/agency-name config))
         :start (fn []
                  (.post client #js {:agency "eyeHeadTracking" :type "start"}))
         :setMode (fn [mode]
                    (.post client #js {:agency "eyeHeadTracking" :type "setMode" :mode mode}))
         :setGazeTarget (fn [target]
                          (.post client #js {:agency "eyeHeadTracking" :type "setGazeTarget" :target target}))
         :setTarget (fn [target]
                      (.post client #js {:agency "eyeHeadTracking" :type "setTarget" :target target}))
         :schedule (fn [target]
                     (.post client #js {:agency "eyeHeadTracking" :type "schedule" :target target}))
         :resetToNeutral (fn
                           ([] (.post client #js {:agency "eyeHeadTracking" :type "resetToNeutral"}))
                           ([duration] (.post client #js {:agency "eyeHeadTracking" :type "resetToNeutral" :duration duration})))
         :pause (fn []
                  (.post client #js {:agency "eyeHeadTracking" :type "pause"}))
         :resume (fn []
                   (.post client #js {:agency "eyeHeadTracking" :type "resume"}))
         :stop (fn []
                 (.post client #js {:agency "eyeHeadTracking" :type "stop"}))
         :dispose (fn []
                    (.dispose client))}))

(defn create-gaze-worker-client [worker host]
  (let [client (create-worker-client worker host)]
    #js {:configure (fn [config]
                      (.configure client gaze/agency-name config))
         :updateConfig (fn [config]
                         (.configure client gaze/agency-name config))
         :setMode (fn [mode]
                    (.post client #js {:agency "gaze" :type "setMode" :mode mode}))
         :setTarget (fn [target]
                      (.post client #js {:agency "gaze" :type "setTarget" :target target}))
         :schedule (fn [target]
                     (.post client #js {:agency "gaze" :type "schedule" :target target}))
         :resetToNeutral (fn
                           ([] (.post client #js {:agency "gaze" :type "resetToNeutral"}))
                           ([duration] (.post client #js {:agency "gaze" :type "resetToNeutral" :duration duration})))
         :stop (fn []
                 (.post client #js {:agency "gaze" :type "stop"}))
         :dispose (fn []
                    (.dispose client))}))
