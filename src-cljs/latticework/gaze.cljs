(ns latticework.gaze
  (:require [latticework.protocol :as protocol]))

(def agency-name "gaze")

(def eye-head-aus
  {:eye-yaw-left "61"
   :eye-yaw-right "62"
   :eye-pitch-up "63"
   :eye-pitch-down "64"
   :head-yaw-left "51"
   :head-yaw-right "52"
   :head-pitch-up "53"
   :head-pitch-down "54"
   :head-roll-left "55"
   :head-roll-right "56"})

(def default-config
  {:eyesEnabled true
   :headEnabled true
   :headFollowEyes true
   :mirrored false
   :smoothFactor 0.25
   :minDelta 0.01
   :eyeIntensity 1.0
   :headIntensity 0.5
   :duration 200
   :eyePriority 20
   :headPriority 15
   :headRoll 0})

(def default-state
  {:target {:x 0 :y 0 :z 0}
   :current {:x 0 :y 0 :z 0}
   :mode "manual"
   :isActive false
   :scheduledGazeCount 0
   :lastScheduledTime nil
   :config default-config})

(def snippet-names
  ["eyeHeadTracking/eyeYaw"
   "eyeHeadTracking/eyePitch"
   "eyeHeadTracking/headYaw"
   "eyeHeadTracking/headPitch"
   "eyeHeadTracking/headRoll"])

(defn normalize-config [config]
  (let [config (or config {})]
    (merge default-config
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
                         :headRoll]))))

(defn normalize-target [target]
  (let [target (or target {})
        x (protocol/clamp -1 1 (protocol/maybe-number (:x target) 0))
        y (protocol/clamp -1 1 (protocol/maybe-number (:y target) 0))
        z (protocol/clamp -1 1 (protocol/maybe-number (:z target) 0))]
    {:x x :y y :z z}))

(defn create-state
  ([] (create-state nil))
  ([config]
   (atom (assoc default-state :config (normalize-config config)))))

(defn snapshot [state]
  @state)

(defn configure! [state config]
  (swap! state update :config merge (normalize-config config))
  [(protocol/emit-state agency-name @state)])

(defn set-mode! [state mode]
  (let [mode (if (contains? #{"manual" "mouse" "webcam"} mode) mode "manual")]
    (swap! state assoc :mode mode)
    [(protocol/emit-state agency-name @state)]))

(defn distance [a b]
  (let [dx (- (:x a) (:x b))
        dy (- (:y a) (:y b))]
    (js/Math.hypot dx dy)))

(defn smooth-target [config previous target]
  (let [raw (normalize-target target)
        tx (if (:mirrored config) (- (:x raw)) (:x raw))
        ty (:y raw)
        target* {:x tx :y ty :z (:z raw)}
        dist (distance target* previous)
        base-alpha (protocol/clamp 0 1 (protocol/maybe-number (:smoothFactor config) 0.25))
        alpha (protocol/clamp 0 0.7 (+ base-alpha (* dist 0.25)))]
    {:x (+ (:x previous) (* (- tx (:x previous)) alpha))
     :y (+ (:y previous) (* (- ty (:y previous)) alpha))
     :z (:z target*)}))

(defn should-schedule? [config previous target]
  (let [min-delta (protocol/clamp 0 1 (protocol/maybe-number (:minDelta config) 0.01))]
    (>= (distance previous target) min-delta)))

(defn axis-curves [negative-au positive-au value duration-sec]
  (let [end-time (max 0.001 duration-sec)
        value (protocol/clamp -1 1 value)]
    (if (neg? value)
      {negative-au [{:time 0 :intensity 0 :inherit true}
                    {:time end-time :intensity (js/Math.abs value)}]
       positive-au [{:time 0 :intensity 0 :inherit true}
                    {:time end-time :intensity 0}]}
      {negative-au [{:time 0 :intensity 0 :inherit true}
                    {:time end-time :intensity 0}]
       positive-au [{:time 0 :intensity 0 :inherit true}
                    {:time end-time :intensity value}]})))

(defn snippet [name curves duration-sec priority]
  {:name name
   :curves curves
   :maxTime duration-sec
   :loop false
   :mixerClampWhenFinished true
   :snippetCategory "eyeHeadTracking"
   :snippetPriority priority
   :snippetPlaybackRate 1.0
   :snippetIntensityScale 1.0})

(defn build-snippets [config target]
  (let [duration (protocol/maybe-number (:duration config) 200)
        eye-duration-sec (/ (protocol/maybe-number (:eyeDuration config) duration) 1000)
        head-duration-sec (/ (protocol/maybe-number (:headDuration config) duration) 1000)
        eye-intensity (protocol/clamp 0 2 (protocol/maybe-number (:eyeIntensity config) 1.0))
        head-intensity (protocol/clamp 0 2 (protocol/maybe-number (:headIntensity config) 0.5))
        eye-priority (protocol/maybe-number (:eyePriority config) 20)
        head-priority (protocol/maybe-number (:headPriority config) 15)
        head-roll (protocol/clamp -1 1 (protocol/maybe-number (:headRoll config) 0))
        x (:x target)
        y (:y target)
        outputs []]
    (cond-> outputs
      (:eyesEnabled config)
      (conj
       (snippet "eyeHeadTracking/eyeYaw"
                (axis-curves (:eye-yaw-left eye-head-aus)
                             (:eye-yaw-right eye-head-aus)
                             (* x eye-intensity)
                             eye-duration-sec)
                eye-duration-sec
                eye-priority)
       (snippet "eyeHeadTracking/eyePitch"
                (axis-curves (:eye-pitch-down eye-head-aus)
                             (:eye-pitch-up eye-head-aus)
                             (* y eye-intensity)
                             eye-duration-sec)
                eye-duration-sec
                eye-priority))

      (and (:headEnabled config) (:headFollowEyes config))
      (conj
       (snippet "eyeHeadTracking/headYaw"
                (axis-curves (:head-yaw-left eye-head-aus)
                             (:head-yaw-right eye-head-aus)
                             (* x head-intensity)
                             head-duration-sec)
                head-duration-sec
                head-priority)
       (snippet "eyeHeadTracking/headPitch"
                (axis-curves (:head-pitch-down eye-head-aus)
                             (:head-pitch-up eye-head-aus)
                             (* y head-intensity)
                             head-duration-sec)
                head-duration-sec
                head-priority)
       (snippet "eyeHeadTracking/headRoll"
                (axis-curves (:head-roll-left eye-head-aus)
                             (:head-roll-right eye-head-aus)
                             (* head-roll head-intensity)
                             head-duration-sec)
                head-duration-sec
                head-priority)))))

(defn schedule-target!
  ([state target] (schedule-target! state target false))
  ([state target force?]
   (let [current @state
         config (:config current)
         previous (:current current)
         normalized (normalize-target target)
         smoothed (if force? normalized (smooth-target config previous target))
         should-apply (or force? (should-schedule? config previous smoothed))
         now (.round js/Math (protocol/now-ms))]
     (if-not should-apply
       (do
         (swap! state assoc :target normalized)
         [(protocol/emit-state agency-name @state)])
       (let [snippets (build-snippets config smoothed)
             remove-outputs (mapv #(protocol/emit-remove-snippet agency-name %) (map :name snippets))
             schedule-outputs (mapv #(protocol/emit-schedule-snippet agency-name % {:autoPlay true}) snippets)]
         (swap! state
                (fn [state*]
                  (-> state*
                      (assoc :target normalized
                             :current smoothed
                             :isActive true
                             :lastScheduledTime now)
                      (update :scheduledGazeCount inc))))
         (vec (concat remove-outputs
                      schedule-outputs
                      [(protocol/emit-state agency-name @state)])))))))

(defn stop! [state]
  (swap! state assoc :isActive false)
  (vec (concat
        (map #(protocol/emit-remove-snippet agency-name %) snippet-names)
        [(protocol/emit-state agency-name @state)])))

(defn reset-to-neutral! [state duration]
  (when (number? duration)
    (swap! state assoc-in [:config :duration] duration))
  (schedule-target! state {:x 0 :y 0 :z 0} true))

(defn handle-command! [state command]
  (case (:type command)
    "configure" (configure! state (:config command))
    "updateConfig" (configure! state (:config command))
    "setMode" (set-mode! state (:mode command))
    "setTarget" (schedule-target! state (:target command))
    "schedule" (schedule-target! state (:target command))
    "resetToNeutral" (reset-to-neutral! state (:duration command))
    "stop" (stop! state)
    [(protocol/emit-error agency-name (str "Unsupported gaze command: " (:type command)))]))
