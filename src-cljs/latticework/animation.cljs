(ns latticework.animation
  (:require [latticework.protocol :as protocol]))

(def agency-name "animation")

(def default-state
  {:snippets {}
   :order []
   :schedule {}
   :globalPlaybackState "stopped"
   :eventCount 0
   :lastUpdatedTime nil})

(defn- now []
  (.round js/Math (protocol/now-ms)))

(defn- key->string [value]
  (cond
    (keyword? value) (name value)
    (string? value) value
    (number? value) (str value)
    :else (str value)))

(defn- finite-number? [value]
  (and (number? value) (.isFinite js/Number value)))

(defn- number-or [value fallback]
  (if (finite-number? value) value fallback))

(defn- clamp [low high value]
  (protocol/clamp low high (number-or value low)))

(defn- normalize-point [point]
  {:time (number-or (if (contains? point :time) (:time point) (:t point)) 0)
   :intensity (number-or (if (contains? point :intensity) (:intensity point) (:v point)) 0)
   :inherit (boolean (:inherit point))})

(defn normalize-curves [curves]
  (if-not (map? curves)
    {}
    (into {}
          (map (fn [[curve-id points]]
                 [(key->string curve-id)
                  (->> (if (sequential? points) points [])
                       (map normalize-point)
                       (sort-by :time)
                       vec)]))
          curves)))

(defn- curves-from-keyframes [data]
  (let [mapped (atom {})]
    (doseq [point (or (:au data) [])]
      (let [key (key->string (:id point))]
        (swap! mapped update key (fnil conj []) (normalize-point point))))
    (doseq [point (or (:viseme data) [])]
      (let [key (key->string (:key point))]
        (swap! mapped update key (fnil conj []) (normalize-point point))))
    (into {}
          (map (fn [[curve-id points]]
                 [curve-id (vec (sort-by :time points))]))
          @mapped)))

(defn calculate-duration [curves]
  (reduce
   (fn [duration points]
     (let [last-time (:time (last points))]
       (max duration (number-or last-time 0))))
   0
   (vals curves)))

(defn normalize-snippet [data]
  (let [data (or data {})
        curves (if (:curves data)
                 (normalize-curves (:curves data))
                 (curves-from-keyframes data))
        duration (calculate-duration curves)
        mixer-loop-mode (or (:mixerLoopMode data) (if (:loop data) "repeat" "once"))
        reverse? (boolean (:mixerReverse data))
        now-ms (now)]
    (cond-> {:name (or (:name data) (str "sn_" now-ms))
             :curves curves
             :isPlaying (boolean (:isPlaying data))
             :loop (not= mixer-loop-mode "once")
             :loopIteration (number-or (:loopIteration data) 0)
             :loopDirection (if (or (= (:loopDirection data) -1) reverse?) -1 1)
             :lastLoopTime (number-or (:lastLoopTime data) 0)
             :snippetPlaybackRate (number-or (:snippetPlaybackRate data) 1)
             :snippetIntensityScale (number-or (:snippetIntensityScale data) 1)
             :snippetBlendMode (if (= (:snippetBlendMode data) "additive") "additive" "replace")
             :snippetJawScale (number-or (:snippetJawScale data) 1.0)
             :snippetBalance (clamp -1 1 (:snippetBalance data))
             :snippetBalanceMap (or (:snippetBalanceMap data) {})
             :snippetCategory (or (:snippetCategory data) "default")
             :snippetPriority (number-or (:snippetPriority data) 0)
             :snippetEasing (or (:snippetEasing data) "linear")
             :mixerLoopMode mixer-loop-mode
             :mixerReverse reverse?
             :currentTime (number-or (:currentTime data) 0)
             :startWallTime (number-or (:startWallTime data) now-ms)
             :duration duration
             :cursor (or (:cursor data) {})}
      (:aiExpressionMetadata data) (assoc :aiExpressionMetadata (:aiExpressionMetadata data))
      (contains? data :autoVisemeJaw) (assoc :autoVisemeJaw (boolean (:autoVisemeJaw data)))
      (:mixerChannel data) (assoc :mixerChannel (:mixerChannel data))
      (:mixerBlendMode data) (assoc :mixerBlendMode (:mixerBlendMode data))
      (finite-number? (:mixerWeight data)) (assoc :mixerWeight (:mixerWeight data))
      (finite-number? (:mixerFadeDurationMs data)) (assoc :mixerFadeDurationMs (:mixerFadeDurationMs data))
      (finite-number? (:mixerWarpDurationMs data)) (assoc :mixerWarpDurationMs (:mixerWarpDurationMs data))
      (finite-number? (:mixerTimeScale data)) (assoc :mixerTimeScale (:mixerTimeScale data))
      (finite-number? (:mixerRepeatCount data)) (assoc :mixerRepeatCount (:mixerRepeatCount data))
      (contains? data :mixerClampWhenFinished) (assoc :mixerClampWhenFinished (boolean (:mixerClampWhenFinished data)))
      (contains? data :mixerAdditive) (assoc :mixerAdditive (boolean (:mixerAdditive data))))))

(defn create-state
  ([] (create-state nil))
  ([config]
   (let [initial-snippets (map normalize-snippet (or (:snippets config) []))
         snippets-by-name (into {} (map (juxt :name identity) initial-snippets))]
     (atom (-> default-state
               (assoc :snippets snippets-by-name
                      :order (mapv :name initial-snippets)
                      :globalPlaybackState (or (:globalPlaybackState config) "stopped")))))))

(defn snapshot [state]
  @state)

(defn- state-output [agency-state]
  (protocol/emit-state agency-name agency-state))

(defn- event-output [event]
  {:type "animationEvent"
   :agency agency-name
   :event (assoc event :timestamp (now))})

(defn- effect-output [op payload]
  (protocol/emit-animation-effect agency-name (assoc payload :op op)))

(defn- schedule-state [snippet opts]
  {:name (:name snippet)
   :startsAt (number-or (:startAtSec opts) 0)
   :offset (number-or (:offsetSec opts) 0)
   :enabled true})

(defn- upsert-snippet-state [state snippet opts is-playing?]
  (swap! state
         (fn [current]
           (let [name (:name snippet)
                 snippet* (assoc snippet
                                 :isPlaying (boolean is-playing?)
                                 :currentTime (number-or (:offsetSec opts) (:currentTime snippet))
                                 :startWallTime (now))]
             (-> current
                 (assoc-in [:snippets name] snippet*)
                 (update :order (fn [order]
                                  (if (some #(= name %) order)
                                    order
                                    (conj (vec order) name))))
                 (assoc-in [:schedule name] (schedule-state snippet* opts))
                 (update :eventCount inc)
                 (assoc :lastUpdatedTime (now)))))))

(defn- result [value outputs]
  {:result value :outputs outputs})

(defn load! [state data]
  (let [snippet (normalize-snippet data)
        name (:name snippet)]
    (upsert-snippet-state state snippet {} (:isPlaying snippet))
    (result name
            [(event-output {:type "SNIPPET_ADDED" :snippetName name})
             (state-output @state)])))

(defn schedule! [state data opts]
  (let [opts (or opts {})
        snippet (normalize-snippet data)
        snippet (if (finite-number? (:priority opts))
                  (assoc snippet :snippetPriority (:priority opts))
                  snippet)
        name (:name snippet)
        should-play (or (boolean (:autoPlay opts))
                        (= "playing" (:globalPlaybackState @state)))]
    (upsert-snippet-state state snippet opts should-play)
    (result name
            (cond-> [(protocol/emit-schedule-snippet agency-name snippet opts)
                     (event-output {:type "SNIPPET_ADDED" :snippetName name})]
              should-play (conj (event-output {:type "SNIPPET_PLAY_STATE_CHANGED"
                                               :snippetName name
                                               :isPlaying true}))
              true (conj (state-output @state))))))

(defn update-snippet! [state data]
  (let [requested-name (:name data)
        existing (get-in @state [:snippets requested-name])
        snippet (normalize-snippet (merge existing data))
        name (:name snippet)
        should-play (boolean (or (:isPlaying data) (:isPlaying existing)))]
    (upsert-snippet-state state snippet (get-in @state [:schedule name]) should-play)
    (result name
            [(effect-output "updateSnippet" {:snippet snippet})
             (event-output {:type "SNIPPET_UPDATED" :snippetName name})
             (state-output @state)])))

(defn remove! [state name]
  (let [name (key->string name)]
    (swap! state
           (fn [current]
             (-> current
                 (update :snippets dissoc name)
                 (update :schedule dissoc name)
                 (update :order (fn [order] (vec (remove #(= name %) order))))
                 (update :eventCount inc)
                 (assoc :lastUpdatedTime (now)))))
    (result true
            [(protocol/emit-remove-snippet agency-name name)
             (event-output {:type "SNIPPET_REMOVED" :snippetName name})
             (state-output @state)])))

(defn play! [state]
  (let [names (:order @state)]
    (swap! state
           (fn [current]
             (-> current
                 (assoc :globalPlaybackState "playing")
                 (update :snippets
                         (fn [snippets]
                           (into {}
                                 (map (fn [[name snippet]]
                                        [name (assoc snippet :isPlaying true :startWallTime (now))]))
                                 snippets)))
                 (update :eventCount inc)
                 (assoc :lastUpdatedTime (now)))))
    (result true
            (vec (concat
                  [(effect-output "playAll" {})]
                  (map #(event-output {:type "SNIPPET_PLAY_STATE_CHANGED"
                                       :snippetName %
                                       :isPlaying true})
                       names)
                  [(event-output {:type "GLOBAL_PLAYBACK_CHANGED" :state "playing"})
                   (state-output @state)])))))

(defn pause! [state]
  (let [playing-names (->> (:order @state)
                           (filter #(get-in @state [:snippets % :isPlaying])))]
    (swap! state
           (fn [current]
             (-> current
                 (assoc :globalPlaybackState "paused")
                 (update :snippets
                         (fn [snippets]
                           (into {}
                                 (map (fn [[name snippet]]
                                        [name (assoc snippet :isPlaying false)]))
                                 snippets)))
                 (update :eventCount inc)
                 (assoc :lastUpdatedTime (now)))))
    (result true
            (vec (concat
                  [(effect-output "pauseAll" {})]
                  (map #(event-output {:type "SNIPPET_PLAY_STATE_CHANGED"
                                       :snippetName %
                                       :isPlaying false})
                       playing-names)
                  [(event-output {:type "GLOBAL_PLAYBACK_CHANGED" :state "paused"})
                   (state-output @state)])))))

(defn stop! [state]
  (let [names (:order @state)]
    (swap! state
           (fn [current]
             (-> current
                 (assoc :globalPlaybackState "stopped")
                 (update :snippets
                         (fn [snippets]
                           (into {}
                                 (map (fn [[name snippet]]
                                        [name (assoc snippet
                                                     :isPlaying false
                                                     :currentTime 0
                                                     :loopIteration 0
                                                     :lastLoopTime 0
                                                     :loopDirection (if (:mixerReverse snippet) -1 1))]))
                                 snippets)))
                 (update :eventCount inc)
                 (assoc :lastUpdatedTime (now)))))
    (result true
            (vec (concat
                  [(effect-output "stopAll" {})]
                  (map #(event-output {:type "SNIPPET_PLAY_STATE_CHANGED"
                                       :snippetName %
                                       :isPlaying false})
                       names)
                  [(event-output {:type "GLOBAL_PLAYBACK_CHANGED" :state "stopped"})
                   (state-output @state)])))))

(defn enable! [state name on?]
  (let [name (key->string name)
        enabled? (boolean on?)]
    (swap! state
           (fn [current]
             (-> current
                 (assoc-in [:schedule name :enabled] enabled?)
                 (assoc-in [:schedule name :name] name)
                 (update :eventCount inc)
                 (assoc :lastUpdatedTime (now)))))
    (result true
            [(effect-output (if enabled? "resumeSnippet" "pauseSnippet") {:name name})
             (event-output {:type "SNIPPET_PLAY_STATE_CHANGED"
                            :snippetName name
                            :isPlaying enabled?})
             (state-output @state)])))

(defn seek! [state name time]
  (let [name (key->string name)
        time (max 0 (number-or time 0))]
    (swap! state
           (fn [current]
             (-> current
                 (assoc-in [:schedule name :offset] time)
                 (assoc-in [:snippets name :currentTime] time)
                 (update :eventCount inc)
                 (assoc :lastUpdatedTime (now)))))
    (result true
            [(effect-output "seekSnippet" {:name name :offsetSec time})
             (event-output {:type "SNIPPET_SEEKED" :snippetName name :time time})
             (state-output @state)])))

(defn- set-param! [state name key value op params]
  (let [name (key->string name)]
    (swap! state
           (fn [current]
             (-> current
                 (assoc-in [:snippets name key] value)
                 (update :eventCount inc)
                 (assoc :lastUpdatedTime (now)))))
    (result true
            [(effect-output op (assoc params :name name))
             (event-output {:type "SNIPPET_PARAMS_CHANGED" :snippetName name :params params})
             (state-output @state)])))

(defn set-playback-rate! [state name rate]
  (let [rate (if (and (finite-number? rate) (pos? rate)) rate 1)]
    (set-param! state name :snippetPlaybackRate rate "setSnippetPlaybackRate" {:playbackRate rate})))

(defn set-intensity-scale! [state name scale]
  (let [scale (max 0 (number-or scale 1))]
    (set-param! state name :snippetIntensityScale scale "setSnippetIntensityScale" {:intensityScale scale})))

(defn set-loop-mode! [state name mode]
  (let [mode (if (contains? #{"once" "repeat" "pingpong"} mode) mode "once")]
    (swap! state assoc-in [:snippets (key->string name) :loop] (not= mode "once"))
    (set-param! state name :mixerLoopMode mode "setSnippetLoopMode" {:mixerLoopMode mode :loop (not= mode "once")})))

(defn set-reverse! [state name reverse?]
  (set-param! state name :mixerReverse (boolean reverse?) "setSnippetReverse" {:reverse (boolean reverse?)}))

(defn set-playing! [state name playing?]
  (let [name (key->string name)
        playing? (boolean playing?)]
    (swap! state
           (fn [current]
             (-> current
                 (assoc-in [:snippets name :isPlaying] playing?)
                 (update :eventCount inc)
                 (assoc :lastUpdatedTime (now)))))
    (result true
            [(effect-output (if playing? "resumeSnippet" "pauseSnippet") {:name name})
             (event-output {:type "SNIPPET_PLAY_STATE_CHANGED" :snippetName name :isPlaying playing?})
             (state-output @state)])))

(defn schedule-snapshot [state]
  (mapv
   (fn [name]
     (let [snippet (get-in @state [:snippets name])
           sched (get-in @state [:schedule name])]
       {:name name
        :enabled (not= false (:enabled sched))
        :startsAt (number-or (:startsAt sched) 0)
        :offset (number-or (:offset sched) 0)
        :localTime (number-or (:currentTime snippet) 0)
        :duration (number-or (:duration snippet) 0)
        :loop (not= (:mixerLoopMode snippet) "once")
        :priority (number-or (:snippetPriority snippet) 0)
        :playbackRate (number-or (:snippetPlaybackRate snippet) 1)
        :intensityScale (number-or (:snippetIntensityScale snippet) 1)}))
   (:order @state)))

(defn- outputs [command-result]
  (:outputs command-result))

(defn handle-command! [state command]
  (case (:type command)
    "loadFromJSON" (outputs (load! state (:data command)))
    "schedule" (outputs (schedule! state (:snippet command) (:opts command)))
    "updateSnippet" (outputs (update-snippet! state (:snippet command)))
    "remove" (outputs (remove! state (:name command)))
    "play" (outputs (play! state))
    "pause" (outputs (pause! state))
    "stop" (outputs (stop! state))
    "enable" (outputs (enable! state (:name command) (:on command)))
    "seek" (outputs (seek! state (:name command) (:offsetSec command)))
    "setSnippetPlaying" (outputs (set-playing! state (:name command) (:isPlaying command)))
    "setSnippetTime" (outputs (seek! state (:name command) (:time command)))
    "setSnippetPlaybackRate" (outputs (set-playback-rate! state (:name command) (:rate command)))
    "setSnippetIntensityScale" (outputs (set-intensity-scale! state (:name command) (:scale command)))
    "setSnippetLoopMode" (outputs (set-loop-mode! state (:name command) (:mode command)))
    "setSnippetReverse" (outputs (set-reverse! state (:name command) (:reverse command)))
    [(protocol/emit-error agency-name (str "Unsupported animation command: " (:type command)))]))
