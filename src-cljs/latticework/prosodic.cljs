(ns latticework.prosodic
  (:require [latticework.protocol :as protocol]))

(def agency-name "prosodic")

(def default-config
  {:browPriority 2
   :headPriority 2
   :pulsePriority 5
   :defaultIntensity 0.7
   :fadeSteps 4
   :fadeStepInterval 120})

(def default-state
  {:status "idle"
   :browSnippet nil
   :headSnippet nil
   :scheduledNames {:brow nil :head nil}
   :fadeInProgress {:brow false :head false}
   :lastPulseWordIndex nil
   :config default-config
   :eventCount 0
   :lastUpdatedTime nil})

(defn- now []
  (.round js/Math (protocol/now-ms)))

(defn- finite-number? [value]
  (and (number? value) (.isFinite js/Number value)))

(defn- number-or [value fallback]
  (if (finite-number? value) value fallback))

(defn- clamp [low high value]
  (protocol/clamp low high (number-or value low)))

(defn- key->string [value]
  (cond
    (keyword? value) (name value)
    (string? value) value
    (number? value) (str value)
    :else (str value)))

(defn normalize-curves [curves]
  (let [normalized
        (if-not (map? curves)
          {}
          (into {}
                (map (fn [[curve-id points]]
                       [(key->string curve-id)
                        (->> (if (sequential? points) points [])
                             (map (fn [point]
                                    {:time (number-or (if (contains? point :time) (:time point) (:t point)) 0)
                                     :intensity (number-or (if (contains? point :intensity) (:intensity point) (:v point)) 0)}))
                             (sort-by :time)
                             vec)]))
                curves))
        max-abs (reduce
                 (fn [max-value points]
                   (reduce (fn [inner point]
                             (max inner (js/Math.abs (number-or (:intensity point) 0))))
                           max-value
                           points))
                 0
                 (vals normalized))]
    (if (> max-abs 1)
      (into {}
            (map (fn [[curve-id points]]
                   [curve-id (mapv #(update % :intensity / 100) points)]))
            normalized)
      normalized)))

(defn calculate-duration [curves]
  (reduce
   (fn [duration points]
     (max duration (number-or (:time (last points)) 0)))
   0
   (vals curves)))

(defn normalize-snippet [data category priority default-intensity]
  (when data
    (let [curves (normalize-curves (:curves data))
          duration (calculate-duration curves)
          category (if (= category "head") "head" "brow")]
      {:name (or (:name data) (str category "_" (now)))
       :curves curves
       :category category
       :priority (number-or (:priority data) priority)
       :intensityScale (number-or (:snippetIntensityScale data) default-intensity)
       :isPlaying false
       :loop false
       :currentTime 0
       :startWallTime (now)
       :duration duration
       :playbackRate (number-or (:snippetPlaybackRate data) 1.0)})))

(defn create-state
  ([] (create-state nil))
  ([config]
   (atom (assoc default-state :config (merge default-config (or config {}))))))

(defn snapshot [state]
  @state)

(defn prosodic-state [state]
  (let [current @state
        brow (:browSnippet current)
        head (:headSnippet current)
        fading (:fadeInProgress current)
        status (:status current)]
    {:browStatus (cond
                   (= status "speaking") "active"
                   (:brow fading) "stopping"
                   :else "idle")
     :headStatus (cond
                   (= status "speaking") "active"
                   (:head fading) "stopping"
                   :else "idle")
     :browIntensity (number-or (:intensityScale brow) 0)
     :headIntensity (number-or (:intensityScale head) 0)
     :isLooping (= status "speaking")}))

(defn- state-output [state]
  (protocol/emit-state agency-name @state))

(defn- event-output [event]
  {:type "prosodicEvent"
   :agency agency-name
   :event (assoc event :timestamp (now))})

(defn- fade-plan-output [plan]
  {:type "prosodicFadePlan"
   :agency agency-name
   :plan plan})

(defn- animation-snippet [snippet]
  {:name (:name snippet)
   :curves (:curves snippet)
   :maxTime (:duration snippet)
   :loop false
   :mixerClampWhenFinished true
   :snippetCategory "prosodic"
   :snippetPriority (:priority snippet)
   :snippetPlaybackRate (:playbackRate snippet)
   :snippetIntensityScale (:intensityScale snippet)
   :snippetBlendMode "additive"})

(defn- schedule-output [snippet]
  (protocol/emit-schedule-snippet agency-name (animation-snippet snippet) {:autoPlay true}))

(defn- update-state! [state update-fn]
  (swap! state
         (fn [current]
           (-> current
               update-fn
               (update :eventCount inc)
               (assoc :lastUpdatedTime (now))))))

(defn load-brow! [state data]
  (let [config (:config @state)
        snippet (normalize-snippet data "brow" (:browPriority config) (:defaultIntensity config))]
    (update-state! state #(assoc % :browSnippet snippet))
    [(event-output {:type "BROW_LOADED" :snippetName (:name snippet)})
     (state-output state)]))

(defn load-head! [state data]
  (let [config (:config @state)
        snippet (normalize-snippet data "head" (:headPriority config) (:defaultIntensity config))]
    (update-state! state #(assoc % :headSnippet snippet))
    [(event-output {:type "HEAD_LOADED" :snippetName (:name snippet)})
     (state-output state)]))

(defn update-config! [state config]
  (update-state! state #(update % :config merge (or config {})))
  [(state-output state)])

(defn start-talking! [state]
  (let [current @state
        brow (:browSnippet current)
        head (:headSnippet current)]
    (update-state!
     state
     #(-> %
          (assoc :status "speaking"
                 :fadeInProgress {:brow false :head false}
                 :scheduledNames {:brow (:name brow) :head (:name head)})
          (cond->
            brow (assoc :browSnippet (assoc brow :isPlaying true :currentTime 0 :startWallTime (now)))
            head (assoc :headSnippet (assoc head :isPlaying true :currentTime 0 :startWallTime (now))))))
    (vec (concat
          (cond-> []
            brow (conj (schedule-output (get-in @state [:browSnippet])))
            head (conj (schedule-output (get-in @state [:headSnippet]))))
          [(event-output {:type "START_SPEAKING"})
           (state-output state)]))))

(defn pulse! [state word-index]
  (let [word-index (int (number-or word-index 0))
        current @state
        brow (:browSnippet current)
        head (:headSnippet current)
        brow-name (get-in current [:scheduledNames :brow])
        head-name (get-in current [:scheduledNames :head])
        pulse-head? (odd? word-index)]
    (update-state!
     state
     #(-> %
          (assoc :lastPulseWordIndex word-index)
          (cond->
            brow (assoc-in [:browSnippet :currentTime] 0)
            brow (assoc-in [:browSnippet :startWallTime] (now))
            (and head pulse-head?) (assoc-in [:headSnippet :currentTime] 0)
            (and head pulse-head?) (assoc-in [:headSnippet :startWallTime] (now)))))
    (vec (concat
          (cond-> []
            (and brow brow-name)
            (conj (protocol/emit-remove-snippet agency-name brow-name)
                  (schedule-output (get-in @state [:browSnippet])))

            (and head head-name pulse-head?)
            (conj (protocol/emit-remove-snippet agency-name head-name)
                  (schedule-output (get-in @state [:headSnippet]))))
          [(event-output {:type "PULSE" :wordIndex word-index :channel "both"})
           (state-output state)]))))

(defn stop-talking! [state]
  (let [current @state
        config (:config current)
        steps (max 1 (int (number-or (:fadeSteps config) 4)))
        interval (max 0 (number-or (:fadeStepInterval config) 120))
        scheduled (:scheduledNames current)
        step-plan (fn [channel name]
                    (when name
                      (mapv
                       (fn [index]
                         (let [last? (= index steps)]
                           {:channel channel
                            :name name
                            :intensity (- 1 (/ index steps))
                            :delayMs (* (dec index) interval)
                            :removeOnComplete last?}))
                       (range 1 (inc steps)))))]
    (update-state! state #(assoc % :status "fading" :fadeInProgress {:brow true :head true}))
    (vec (concat
          [(fade-plan-output {:steps (vec (concat (or (step-plan "brow" (:brow scheduled)) [])
                                                  (or (step-plan "head" (:head scheduled)) [])))})
           (event-output {:type "STOP_SPEAKING"})]
          [(state-output state)]))))

(defn stop! [state]
  (let [scheduled (:scheduledNames @state)]
    (update-state!
     state
     #(assoc % :status "idle"
             :browSnippet (when-let [brow (:browSnippet %)] (assoc brow :isPlaying false :intensityScale 0))
             :headSnippet (when-let [head (:headSnippet %)] (assoc head :isPlaying false :intensityScale 0))
             :fadeInProgress {:brow false :head false}
             :scheduledNames {:brow nil :head nil}))
    (vec (concat
          (cond-> []
            (:brow scheduled) (conj (protocol/emit-remove-snippet agency-name (:brow scheduled)))
            (:head scheduled) (conj (protocol/emit-remove-snippet agency-name (:head scheduled))))
          [(event-output {:type "STOP_IMMEDIATE"})
           (state-output state)]))))

(defn handle-command! [state command]
  (case (:type command)
    "loadBrow" (load-brow! state (:data command))
    "loadHead" (load-head! state (:data command))
    "updateConfig" (update-config! state (:config command))
    "startTalking" (start-talking! state)
    "stopTalking" (stop-talking! state)
    "pulse" (pulse! state (:wordIndex command))
    "stop" (stop! state)
    [(protocol/emit-error agency-name (str "Unsupported prosodic command: " (:type command)))]))
