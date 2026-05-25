(ns latticework.blink
  (:require [latticework.protocol :as protocol]))

(def agency-name "blink")

(def default-state
  {:enabled false
   :frequency 17
   :duration 0.15
   :intensity 1.0
   :randomness 0.3
   :leftEyeIntensity nil
   :rightEyeIntensity nil
   :lastBlinkTime nil
   :scheduledBlinkCount 0})

(defn normalize-config [config]
  (let [config (or config {})]
    (merge default-state
           (select-keys config
                        [:enabled
                         :frequency
                         :duration
                         :intensity
                         :randomness
                         :leftEyeIntensity
                         :rightEyeIntensity]))))

(defn create-state
  ([] (create-state nil))
  ([config]
   (atom (normalize-config config))))

(defn snapshot [state]
  @state)

(defn configure! [state config]
  (swap! state merge (normalize-config (merge @state config)))
  [(protocol/emit-state agency-name @state)])

(defn enable! [state]
  (swap! state assoc :enabled true)
  [(protocol/emit-state agency-name @state)])

(defn disable! [state]
  (swap! state assoc :enabled false)
  [(protocol/emit-state agency-name @state)])

(defn set-frequency! [state frequency]
  (swap! state assoc :frequency (protocol/clamp 0 60 (protocol/maybe-number frequency (:frequency @state))))
  [(protocol/emit-state agency-name @state)])

(defn set-duration! [state duration]
  (swap! state assoc :duration (protocol/clamp 0.05 1.0 (protocol/maybe-number duration (:duration @state))))
  [(protocol/emit-state agency-name @state)])

(defn set-intensity! [state intensity]
  (swap! state assoc :intensity (protocol/clamp 0 1 (protocol/maybe-number intensity (:intensity @state))))
  [(protocol/emit-state agency-name @state)])

(defn set-randomness! [state randomness]
  (swap! state assoc :randomness (protocol/clamp 0 1 (protocol/maybe-number randomness (:randomness @state))))
  [(protocol/emit-state agency-name @state)])

(defn reset-state! [state]
  (cljs.core/reset! state default-state)
  [(protocol/emit-state agency-name @state)])

(defn random-factor [randomness scale]
  (+ 1 (* (- (js/Math.random) 0.5) randomness scale)))

(defn auto-interval-ms [state-snapshot]
  (let [frequency (protocol/maybe-number (:frequency state-snapshot) (:frequency default-state))
        randomness (protocol/maybe-number (:randomness state-snapshot) (:randomness default-state))]
    (when (pos? frequency)
      (* (/ 60 frequency)
         1000
         (random-factor randomness 1.0)))))

(defn auto-command? [command]
  (contains? #{"configure"
               "enable"
               "disable"
               "setFrequency"
               "setRandomness"
               "reset"}
             (:type command)))

(defn build-blink-curves [intensity duration randomness]
  (let [final-intensity (protocol/clamp 0 1 (* intensity (random-factor randomness 0.3)))
        close-time (* duration 0.35)
        hold-time (* duration 0.1)
        open-time (* duration 0.55)
        curve [{:time 0.0 :intensity 0}
               {:time (* close-time 0.3) :intensity (* final-intensity 0.4)}
               {:time close-time :intensity final-intensity}
               {:time (+ close-time hold-time) :intensity (* final-intensity 0.98)}
               {:time (+ close-time hold-time (* open-time 0.5)) :intensity (* final-intensity 0.5)}
               {:time (+ close-time hold-time (* open-time 0.85)) :intensity (* final-intensity 0.15)}
               {:time duration :intensity 0}]]
    {"43" curve}))

(defn build-blink-snippet
  ([state] (build-blink-snippet state nil))
  ([state overrides]
   (let [current @state
         intensity (protocol/clamp
                    0
                    1
                    (protocol/maybe-number (:intensity overrides) (:intensity current)))
         duration (protocol/clamp
                   0.05
                   1.0
                   (protocol/maybe-number (:duration overrides) (:duration current)))
         randomness (:randomness current)
         name (str "blink_" (.round js/Math (protocol/now-ms)))]
     {:name name
      :curves (build-blink-curves intensity duration randomness)
      :maxTime duration
      :loop false
      :snippetCategory "blink"
      :snippetPriority 100
      :snippetPlaybackRate 1.0
      :snippetIntensityScale 1.0})))

(defn trigger-blink! [state overrides]
  (let [snippet (build-blink-snippet state overrides)
        now (.round js/Math (protocol/now-ms))]
    (swap! state
           (fn [current]
             (-> current
                 (assoc :lastBlinkTime now)
                 (update :scheduledBlinkCount inc))))
    [(protocol/emit-schedule-snippet agency-name snippet {:autoPlay true})
     (protocol/emit-state agency-name @state)]))

(defn handle-command! [state command]
  (case (:type command)
    "configure" (configure! state (:config command))
    "enable" (enable! state)
    "disable" (disable! state)
    "setFrequency" (set-frequency! state (:frequency command))
    "setDuration" (set-duration! state (:duration command))
    "setIntensity" (set-intensity! state (:intensity command))
    "setRandomness" (set-randomness! state (:randomness command))
    "reset" (reset-state! state)
    "triggerBlink" (trigger-blink! state command)
    [(protocol/emit-error agency-name (str "Unsupported blink command: " (:type command)))]))
