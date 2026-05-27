(ns latticework.eye-head-tracking
  (:require [latticework.gaze :as gaze]
            [latticework.protocol :as protocol]))

(def agency-name "eyeHeadTracking")

(def snippet-names
  ["eyeHeadTracking/eyeYaw"
   "eyeHeadTracking/eyePitch"
   "eyeHeadTracking/headYaw"
   "eyeHeadTracking/headPitch"
   "eyeHeadTracking/headRoll"])

(defn- has-key? [m k]
  (contains? (or m {}) k))

(defn- config-value [config source fallback]
  (if (has-key? config source)
    (get config source)
    fallback))

(defn normalize-config [config]
  (let [config (or config {})
        duration (config-value config :agencyTransitionDuration (:duration config))]
    (merge
     (select-keys config
                  [:eyesEnabled
                   :headEnabled
                   :headFollowEyes
                   :mirrored
                   :smoothFactor
                   :minDelta
                   :eyeIntensity
                   :headIntensity
                   :duration
                   :eyeDuration
                   :headDuration
                   :eyePriority
                   :headPriority
                   :headRoll])
     (cond-> {}
       (has-key? config :eyeTrackingEnabled)
       (assoc :eyesEnabled (:eyeTrackingEnabled config))

       (has-key? config :headTrackingEnabled)
       (assoc :headEnabled (:headTrackingEnabled config))

       (has-key? config :headFollowEyes)
       (assoc :headFollowEyes (:headFollowEyes config))

       (has-key? config :eyeIntensity)
       (assoc :eyeIntensity (:eyeIntensity config))

       (has-key? config :headIntensity)
       (assoc :headIntensity (:headIntensity config))

       (has-key? config :eyePriority)
       (assoc :eyePriority (:eyePriority config))

       (has-key? config :headPriority)
       (assoc :headPriority (:headPriority config))

       (number? duration)
       (assoc :duration duration)))))

(defn create-state
  ([] (create-state nil))
  ([config]
   (gaze/create-state (normalize-config config))))

(defn snapshot [state]
  @state)

(declare eye-head-state)

(defn- retag-output [state output]
  (cond-> (assoc output :agency agency-name)
    (= (:type output) "state") (assoc :state (eye-head-state state))))

(defn- retag-outputs [state outputs]
  (mapv #(retag-output state %) outputs))

(defn eye-head-state [state]
  (let [current @state
        config (:config current)
        active? (:isActive current)]
    {:eyeStatus (if (and active? (:eyesEnabled config)) "tracking" "idle")
     :headStatus (if (and active? (:headEnabled config) (:headFollowEyes config)) "tracking" "idle")
     :currentGaze (:current current)
     :targetGaze (:target current)
     :eyeIntensity (:eyeIntensity config)
     :lastBlinkTime nil
     :headIntensity (:headIntensity config)
     :headFollowTimer nil
     :isSpeaking false
     :isListening false
     :returnToNeutralTimer nil
     :lastGazeUpdateTime (:lastScheduledTime current)
     :mode (:mode current)
     :scheduledGazeCount (:scheduledGazeCount current)
     :config config}))

(defn- state-output [state]
  (protocol/emit-state agency-name (eye-head-state state)))

(defn configure! [state config]
  (retag-outputs state (gaze/configure! state (normalize-config config))))

(defn set-mode! [state mode]
  (retag-outputs state (gaze/set-mode! state mode)))

(defn start! [state]
  (swap! state assoc :isActive true)
  [(state-output state)])

(defn schedule-target!
  ([state target] (schedule-target! state target false))
  ([state target force?]
   (retag-outputs state (gaze/schedule-target! state target force?))))

(defn reset-to-neutral! [state duration]
  (retag-outputs state (gaze/reset-to-neutral! state duration)))

(defn stop! [state]
  (retag-outputs state (gaze/stop! state)))

(defn- snippet-effect-outputs [op state]
  (vec (concat
        (map #(protocol/emit-animation-effect agency-name {:op op :name %}) snippet-names)
        [(state-output state)])))

(defn pause! [state]
  (snippet-effect-outputs "pauseSnippet" state))

(defn resume! [state]
  (snippet-effect-outputs "resumeSnippet" state))

(defn handle-command! [state command]
  (case (:type command)
    "configure" (configure! state (:config command))
    "updateConfig" (configure! state (:config command))
    "start" (start! state)
    "setMode" (set-mode! state (:mode command))
    "setGazeTarget" (schedule-target! state (:target command))
    "setTarget" (schedule-target! state (:target command))
    "schedule" (schedule-target! state (:target command))
    "resetToNeutral" (reset-to-neutral! state (:duration command))
    "pause" (pause! state)
    "resume" (resume! state)
    "stop" (stop! state)
    [(protocol/emit-error agency-name (str "Unsupported eye/head tracking command: " (:type command)))]))
