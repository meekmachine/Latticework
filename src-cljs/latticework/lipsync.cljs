(ns latticework.lipsync
  (:require [clojure.string :as str]
            [latticework.protocol :as protocol]
            [latticework.vocal :as vocal]))

(def agency-name "lipsync")

(def default-config
  {:lipsyncIntensity 1.0
   :speechRate 1.0
   :onsetIntensity 90
   :holdMs 80
   :engine "webSpeech"
   :jawScale 1.0})

(def default-state
  {:status "idle"
   :wordCount 0
   :isSpeaking false
   :activeSnippets []
   :lastWord nil
   :config default-config
   :eventCount 0
   :lastUpdatedTime nil})

(def azure-to-canonical
  {0 2
   1 0
   2 1
   3 9
   4 7
   5 5
   6 7
   7 14
   8 9
   9 1
   10 9
   11 1
   12 8
   13 10
   14 12
   15 11
   16 3
   17 13
   18 6
   19 12
   20 8
   21 2})

(def diphthong-targets
  {8 [9 14]
   9 [1 14]
   10 [9 4]
   11 [1 7]})

(defn- now []
  (.round js/Math (protocol/now-ms)))

(defn- finite-number? [value]
  (and (number? value) (.isFinite js/Number value)))

(defn- number-or [value fallback]
  (if (finite-number? value) value fallback))

(defn- normalize-config [config]
  (merge default-config (select-keys (or config {}) (keys default-config))))

(defn create-state
  ([] (create-state nil))
  ([config]
   (atom (assoc default-state :config (normalize-config config)))))

(defn snapshot [state]
  @state)

(defn lipsync-state [state]
  (select-keys @state [:status :wordCount :isSpeaking]))

(defn- state-output [state]
  (protocol/emit-state agency-name @state))

(defn- event-output [event]
  {:type "lipsyncEvent"
   :agency agency-name
   :event (assoc event :timestamp (now))})

(defn- cleanup-plan-output [name delay-ms]
  {:type "lipsyncCleanupPlan"
   :agency agency-name
   :plan {:name name :delayMs (max 0 (number-or delay-ms 0))}})

(defn- result [value outputs]
  {:result value :outputs outputs})

(defn- update-state! [state update-fn]
  (swap! state
         (fn [current]
           (-> current
               update-fn
               (update :eventCount inc)
               (assoc :lastUpdatedTime (now))))))

(defn- active-with [active name]
  (vec (distinct (conj (vec active) name))))

(defn- active-without [active name]
  (vec (remove #(= % name) active)))

(defn- sanitize-word [word]
  (str/replace (str/lower-case (or word "")) #"[^a-z0-9]" "_"))

(defn build-word-snippet-name
  ([word] (build-word-snippet-name word (now)))
  ([word timestamp]
   (str "lipsync_" (sanitize-word word) "_" timestamp)))

(defn- build-azure-snippet-name []
  (str "azure_lipsync_" (now)))

(defn- normalize-viseme-event [event]
  {:visemeId (int (protocol/clamp 0 14 (number-or (:visemeId event) 0)))
   :offsetMs (max 0 (number-or (:offsetMs event) 0))
   :durationMs (max 0 (number-or (:durationMs event) 0))})

(defn scale-timeline-to-fit [timeline target-duration-ms]
  (let [estimated-duration (reduce + (map :durationMs timeline))]
    (if (or (empty? timeline) (<= estimated-duration 0))
      timeline
      (let [scale-factor (/ (number-or target-duration-ms estimated-duration) estimated-duration)]
        (loop [remaining timeline
               next-offset 0
               scaled []]
          (if (empty? remaining)
            scaled
            (let [event (first remaining)
                  duration (.round js/Math (* (:durationMs event) scale-factor))]
              (recur (rest remaining)
                     (+ next-offset duration)
                     (conj scaled (assoc event
                                         :offsetMs next-offset
                                         :durationMs duration))))))))))

(defn build-curves [viseme-timeline]
  (let [peak-intensity 0.9
        ramp-sec 0.008]
    (reduce
     (fn [curves event]
       (let [event (normalize-viseme-event event)
             viseme-key (str (:visemeId event))
             start-time (/ (:offsetMs event) 1000)
             end-time (/ (+ (:offsetMs event) (:durationMs event)) 1000)
             duration-sec (max 0 (- end-time start-time))
             ramp (min ramp-sec (/ duration-sec 2))
             ramp-up-end (+ start-time ramp)
             ramp-down-start (max ramp-up-end (- end-time ramp))]
         (update curves viseme-key
                 (fn [curve]
                   (vec (sort-by :time
                                 (concat (or curve [])
                                         [{:time start-time :intensity 0}
                                          {:time ramp-up-end :intensity peak-intensity}
                                          {:time ramp-down-start :intensity peak-intensity}
                                          {:time end-time :intensity 0}])))))))
     {}
     (or viseme-timeline []))))

(defn calculate-max-time [viseme-timeline]
  (if (empty? viseme-timeline)
    0
    (+ (/ (reduce max (map #(+ (:offsetMs %) (:durationMs %)) viseme-timeline)) 1000)
       0.02)))

(defn build-snippet [name viseme-timeline config]
  (let [timeline (mapv normalize-viseme-event viseme-timeline)]
    {:name name
     :curves (build-curves timeline)
     :maxTime (calculate-max-time timeline)
     :loop false
     :snippetCategory "visemeSnippet"
     :snippetPriority 50
     :snippetPlaybackRate 1.0
     :snippetIntensityScale (number-or (:lipsyncIntensity config) 1.0)
     :snippetJawScale (number-or (:jawScale config) 1.0)}))

(defn build-neutral-snippet [config]
  {:name (str "neutral_" (now))
   :curves (into {}
                 (map (fn [index]
                        [(str index) [{:time 0.0 :intensity 0 :inherit true}
                                      {:time 0.08 :intensity 0}]]))
                 (range 15))
   :maxTime 0.08
   :loop false
   :snippetCategory "visemeSnippet"
   :snippetPriority 60
   :snippetPlaybackRate 1.0
   :snippetIntensityScale 1.0
   :snippetJawScale (number-or (:jawScale config) 1.0)})

(defn- schedule-snippet-outputs [snippet cleanup-delay-ms]
  [(protocol/emit-schedule-snippet agency-name snippet {:autoPlay true})
   (cleanup-plan-output (:name snippet) cleanup-delay-ms)])

(defn- word-timeline [word config actual-duration-ms]
  (let [timeline (vocal/word-to-visemes word 0 (number-or (:speechRate config) 1.0))]
    (if (and (finite-number? actual-duration-ms)
             (> actual-duration-ms 0)
             (seq timeline))
      (scale-timeline-to-fit timeline actual-duration-ms)
      timeline)))

(defn start-speech! [state]
  (update-state! state #(assoc % :status "speaking" :isSpeaking true))
  (result true [(event-output {:type "SPEECH_START"})
                (state-output state)]))

(defn process-word! [state word word-index actual-duration-ms snippet-name]
  (let [config (:config @state)
        word-index (int (number-or word-index (:wordCount @state)))
        snippet-name (or snippet-name (build-word-snippet-name word))
        timeline (word-timeline word config actual-duration-ms)]
    (if (empty? timeline)
      (result nil [(event-output {:type "WORD_EMPTY" :word word :wordIndex word-index})
                   (state-output state)])
      (let [snippet (assoc (build-snippet snippet-name timeline config)
                           :snippetIntensityScale 1.0)
            cleanup-ms (+ (* (:maxTime snippet) 1000) 100)]
        (update-state!
         state
         #(-> %
              (assoc :status "speaking"
                     :isSpeaking true
                     :lastWord word
                     :wordCount (max (inc word-index) (inc (:wordCount %))))
              (update :activeSnippets active-with snippet-name)))
        (result snippet-name
                (vec (concat
                      (schedule-snippet-outputs snippet cleanup-ms)
                      [(event-output {:type "WORD_SCHEDULED"
                                      :word word
                                      :wordIndex word-index
                                      :snippetName snippet-name})
                       (state-output state)])))))))

(defn- normalize-azure-visemes [events]
  (->> (or events [])
       (map (fn [event]
              {:providerId (int (number-or (or (:visemeId event) (:viseme_id event)) 0))
               :time (number-or (or (:time event) (:audio_offset event)) 0)}))
       (filter #(finite-number? (:time %)))
       (sort-by :time)
       vec))

(defn- azure-duration-ms [current next-event total-duration-ms]
  (let [offset-ms (max 0 (.round js/Math (* (:time current) 1000)))
        raw-span-ms (if next-event
                      (max 0 (.round js/Math (* (- (:time next-event) (:time current)) 1000)))
                      100)
        remaining-ms (if (finite-number? total-duration-ms)
                       (max 0 (- total-duration-ms offset-ms))
                       js/Infinity)]
    (max 50 (min remaining-ms raw-span-ms 220))))

(defn- push-azure-event [timeline provider-id canonical-id offset-ms duration-ms]
  (if (or (= provider-id 0) (<= duration-ms 0))
    timeline
    (if-let [[first-viseme second-viseme] (get diphthong-targets provider-id)]
      (let [second-offset (min (+ offset-ms duration-ms -38)
                               (+ offset-ms (* duration-ms 0.55)))
            first-duration (max 38 (min duration-ms (+ (- second-offset offset-ms) (* duration-ms 0.25))))
            second-duration (max 38 (- (+ offset-ms duration-ms) second-offset))]
        (conj timeline
              {:visemeId first-viseme :offsetMs (.round js/Math offset-ms) :durationMs (.round js/Math first-duration)}
              {:visemeId second-viseme :offsetMs (.round js/Math second-offset) :durationMs (.round js/Math second-duration)}))
      (conj timeline {:visemeId canonical-id
                      :offsetMs (.round js/Math offset-ms)
                      :durationMs (.round js/Math duration-ms)}))))

(defn azure-visemes-to-timeline [events total-duration-ms]
  (let [events (normalize-azure-visemes events)]
    (loop [index 0
           timeline []]
      (if (>= index (count events))
        (vec (sort-by :offsetMs timeline))
        (let [event (nth events index)
              next-event (when (< (inc index) (count events)) (nth events (inc index)))
              provider-id (:providerId event)
              canonical-id (get azure-to-canonical provider-id 2)
              offset-ms (max 0 (.round js/Math (* (:time event) 1000)))
              duration-ms (azure-duration-ms event next-event total-duration-ms)]
          (recur (inc index)
                 (push-azure-event timeline provider-id canonical-id offset-ms duration-ms)))))))

(defn process-azure-visemes! [state events total-duration-ms snippet-name]
  (let [timeline (azure-visemes-to-timeline events total-duration-ms)
        snippet-name (or snippet-name (build-azure-snippet-name))
        config (:config @state)]
    (if (empty? timeline)
      (result nil [(event-output {:type "AZURE_EMPTY"})
                   (state-output state)])
      (let [snippet (build-snippet snippet-name timeline config)
            cleanup-ms (+ (number-or total-duration-ms (* (:maxTime snippet) 1000)) 200)]
        (update-state!
         state
         #(-> %
              (assoc :status "speaking"
                     :isSpeaking true
                     :lastWord nil)
              (update :activeSnippets active-with snippet-name)))
        (result snippet-name
                (vec (concat
                      (schedule-snippet-outputs snippet cleanup-ms)
                      [(event-output {:type "AZURE_SCHEDULED"
                                      :snippetName snippet-name
                                      :eventCount (count events)})
                       (state-output state)])))))))

(defn end-speech! [state]
  (let [config (:config @state)
        snippet (build-neutral-snippet config)]
    (update-state! state #(assoc % :status "ending" :isSpeaking false))
    (result (:name snippet)
            (vec (concat
                  (schedule-snippet-outputs snippet 120)
                  [(event-output {:type "SPEECH_END" :snippetName (:name snippet)})
                   (state-output state)])))))

(defn cleanup! [state name]
  (let [name (or name (first (:activeSnippets @state)))]
    (if-not name
      (result false [])
      (do
        (update-state!
         state
         #(let [active (active-without (:activeSnippets %) name)
                idle? (empty? active)]
            (assoc %
                   :activeSnippets active
                   :status (if idle? "idle" (:status %))
                   :isSpeaking (if idle? false (:isSpeaking %)))))
        (result true [(protocol/emit-remove-snippet agency-name name)
                      (event-output {:type "SNIPPET_COMPLETED" :snippetName name})
                      (state-output state)])))))

(defn stop! [state]
  (let [names (:activeSnippets @state)]
    (update-state!
     state
     #(assoc % :status "idle"
             :isSpeaking false
             :activeSnippets []))
    (result true
            (vec (concat
                  (map #(protocol/emit-remove-snippet agency-name %) names)
                  [(event-output {:type "STOP_IMMEDIATE"})
                   (state-output state)])))))

(defn update-config! [state config]
  (update-state! state #(update % :config merge (normalize-config config)))
  (result true [(event-output {:type "CONFIG_UPDATED"})
                (state-output state)]))

(defn handle-command! [state command]
  (case (:type command)
    "startSpeech" (start-speech! state)
    "processWord" (process-word! state (:word command) (:wordIndex command) (:actualDurationMs command) (:snippetName command))
    "processAzureVisemes" (process-azure-visemes! state (:events command) (:totalDurationMs command) (:snippetName command))
    "endSpeech" (end-speech! state)
    "stop" (stop! state)
    "updateConfig" (update-config! state (:config command))
    "configure" (update-config! state (:config command))
    "cleanup" (cleanup! state (:name command))
    (result false [(protocol/emit-error agency-name (str "Unsupported lipsync command: " (:type command)))])))
