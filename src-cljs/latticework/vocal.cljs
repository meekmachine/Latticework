(ns latticework.vocal
  (:require [clojure.string :as str]
            [latticework.protocol :as protocol]))

(def agency-name "vocal")

(def canonical-visemes
  {:AE 0
   :Ah 1
   :B_M_P 2
   :Ch_J 3
   :EE 4
   :Er 5
   :F_V 6
   :Ih 7
   :K_G_H_NG 8
   :Oh 9
   :R 10
   :S_Z 11
   :T_L_D_N 12
   :Th 13
   :W_OO 14})

(def jaw-au "26")
(def vocal-snippet-category "combined")
(def word-sync-drift-threshold-sec 0.06)

(def jaw-amounts
  [0.75 0.8 0 0.3 0.2 0.35 0.1 0.2 0.35 0.6 0.35 0.1 0.3 0.15 0.5])

(def default-config
  {:intensity 1.0
   :speechRate 1.0
   :jawScale 1.0
   :rampMs 15
   :holdMs 40
   :priority 50})

(def default-state
  {:isSpeaking false
   :currentWord nil
   :currentViseme nil
   :snippetName nil
   :startTime nil
   :currentSentence nil
   :activeSnippets []
   :config default-config
   :eventCount 0
   :lastUpdatedTime nil})

(def intensity-eps 0.001)
(def coarticulation-strength 0.52)
(def jaw-attack-sec 0.04)
(def jaw-release-sec 0.065)
(def jaw-transition-lead-sec 0.024)
(def jaw-long-gap-sec 0.09)
(def lip-total-activation-cap 1.05)
(def lip-dominant-cap 1.0)
(def lip-secondary-ratio 0.3)
(def lip-secondary-cap 0.22)
(def closure-dominance-threshold 0.55)
(def closure-secondary-cap 0.035)
(def envelope-shoulder-ratio 0.55)
(def envelope-shoulder-intensity 0.62)

(defn- now []
  (.round js/Math (protocol/now-ms)))

(defn- finite-number? [value]
  (and (number? value) (.isFinite js/Number value)))

(defn- number-or [value fallback]
  (if (finite-number? value) value fallback))

(defn- clamp [low high value]
  (protocol/clamp low high (number-or value low)))

(defn- abs-num [value]
  (js/Math.abs value))

(defn- normalize-config [config]
  (merge default-config (select-keys (or config {}) (keys default-config))))

(defn create-state
  ([] (create-state nil))
  ([config]
   (atom (assoc default-state :config (normalize-config config)))))

(defn snapshot [state]
  @state)

(defn vocal-state [state]
  (select-keys @state [:isSpeaking :currentWord :currentViseme :snippetName :startTime]))

(defn- state-output [state]
  (protocol/emit-state agency-name @state))

(defn- event-output [event]
  {:type "vocalEvent"
   :agency agency-name
   :event (assoc event :timestamp (now))})

(defn- cleanup-plan-output [name max-time]
  {:type "vocalCleanupPlan"
   :agency agency-name
   :plan {:name name
          :delayMs (+ (* (max 0 (number-or max-time 0)) 1000) 100)}})

(defn- seek-output [name offset-sec]
  (protocol/emit-animation-effect agency-name {:op "seekSnippet"
                                               :name name
                                               :offsetSec offset-sec}))

(defn- pause-output [name]
  (protocol/emit-animation-effect agency-name {:op "pauseSnippet" :name name}))

(defn- resume-output [name]
  (protocol/emit-animation-effect agency-name {:op "resumeSnippet" :name name}))

(defn- result [value outputs]
  {:result value :outputs outputs})

(defn- update-state! [state update-fn]
  (swap! state
         (fn [current]
           (-> current
               update-fn
               (update :eventCount inc)
               (assoc :lastUpdatedTime (now))))))

(def letter-patterns
  [[#"^th" ["TH"]]
   [#"^sh" ["SH"]]
   [#"^ch" ["CH"]]
   [#"^wh" ["W"]]
   [#"^ph" ["F"]]
   [#"^gh" ["G"]]
   [#"^ng" ["NG"]]
   [#"^ck" ["K"]]
   [#"^qu" ["K" "W"]]
   [#"^oo" ["UW"]]
   [#"^ee" ["IY"]]
   [#"^ea" ["IY"]]
   [#"^ai" ["EY"]]
   [#"^ay" ["EY"]]
   [#"^oa" ["OW"]]
   [#"^ou" ["AW"]]
   [#"^ow" ["OW"]]
   [#"^oi" ["OY"]]
   [#"^oy" ["OY"]]
   [#"^au" ["AO"]]
   [#"^aw" ["AO"]]
   [#"^ie" ["IY"]]
   [#"^ei" ["EY"]]
   [#"^ue" ["UW"]]
   [#"^ui" ["UW"]]
   [#"^a" ["AE"]]
   [#"^e" ["EH"]]
   [#"^i" ["IH"]]
   [#"^o" ["AA"]]
   [#"^u" ["AH"]]
   [#"^y$" ["IY"]]
   [#"^y" ["Y"]]
   [#"^b" ["B"]]
   [#"^c(?=[ei])" ["S"]]
   [#"^c" ["K"]]
   [#"^d" ["D"]]
   [#"^f" ["F"]]
   [#"^g(?=[ei])" ["JH"]]
   [#"^g" ["G"]]
   [#"^h" ["HH"]]
   [#"^j" ["JH"]]
   [#"^k" ["K"]]
   [#"^l" ["L"]]
   [#"^m" ["M"]]
   [#"^n" ["N"]]
   [#"^p" ["P"]]
   [#"^r" ["R"]]
   [#"^s" ["S"]]
   [#"^t" ["T"]]
   [#"^v" ["V"]]
   [#"^w" ["W"]]
   [#"^x" ["K" "S"]]
   [#"^z" ["Z"]]])

(def phoneme-to-viseme
  {"sil" (:B_M_P canonical-visemes)
   "pau" (:B_M_P canonical-visemes)
   "PAUSE" (:B_M_P canonical-visemes)
   "A" (:Ah canonical-visemes)
   "E" (:EE canonical-visemes)
   "I" (:Ih canonical-visemes)
   "O" (:Oh canonical-visemes)
   "U" (:W_OO canonical-visemes)
   "0" (:Th canonical-visemes)
   "X" (:S_Z canonical-visemes)
   "J" (:Ch_J canonical-visemes)
   "AE" (:AE canonical-visemes)
   "AX" (:Ah canonical-visemes)
   "AH" (:Ah canonical-visemes)
   "AA" (:Ah canonical-visemes)
   "AO" (:Oh canonical-visemes)
   "EY" (:EE canonical-visemes)
   "EH" (:EE canonical-visemes)
   "UH" (:W_OO canonical-visemes)
   "ER" (:Er canonical-visemes)
   "Y" (:Ih canonical-visemes)
   "IY" (:EE canonical-visemes)
   "IH" (:Ih canonical-visemes)
   "IX" (:Ih canonical-visemes)
   "W" (:W_OO canonical-visemes)
   "UW" (:W_OO canonical-visemes)
   "OW" (:Oh canonical-visemes)
   "AW" (:Ah canonical-visemes)
   "OY" (:Oh canonical-visemes)
   "AY" (:Ah canonical-visemes)
   "H" (:Ah canonical-visemes)
   "HH" (:Ah canonical-visemes)
   "R" (:R canonical-visemes)
   "L" (:T_L_D_N canonical-visemes)
   "S" (:S_Z canonical-visemes)
   "Z" (:S_Z canonical-visemes)
   "SH" (:S_Z canonical-visemes)
   "CH" (:Ch_J canonical-visemes)
   "JH" (:Ch_J canonical-visemes)
   "ZH" (:S_Z canonical-visemes)
   "TH" (:Th canonical-visemes)
   "DH" (:Th canonical-visemes)
   "F" (:F_V canonical-visemes)
   "V" (:F_V canonical-visemes)
   "D" (:T_L_D_N canonical-visemes)
   "T" (:T_L_D_N canonical-visemes)
   "N" (:T_L_D_N canonical-visemes)
   "K" (:K_G_H_NG canonical-visemes)
   "G" (:K_G_H_NG canonical-visemes)
   "NG" (:K_G_H_NG canonical-visemes)
   "P" (:B_M_P canonical-visemes)
   "B" (:B_M_P canonical-visemes)
   "M" (:B_M_P canonical-visemes)})

(def phoneme-durations
  {"A" 50 "E" 45 "I" 40 "O" 55 "U" 50
   "0" 35 "X" 45 "J" 40
   "P" 25 "B" 25 "T" 20 "D" 20 "K" 30 "G" 30
   "F" 35 "V" 35 "S" 40 "Z" 40 "SH" 45 "ZH" 45 "TH" 35 "DH" 35
   "H" 30 "HH" 30 "CH" 40 "JH" 40 "M" 35 "N" 35 "NG" 40
   "L" 40 "R" 40 "W" 35 "Y" 30
   "IY" 50 "EY" 60 "UW" 50 "OW" 60 "AO" 55
   "IH" 40 "EH" 45 "UH" 45 "AH" 45 "AX" 35
   "AY" 65 "AW" 65 "OY" 70 "ER" 50 "AA" 55 "AE" 55 "IX" 30})

(def pause-durations
  {"PAUSE_SPACE" 0
   "PAUSE_COMMA" 50
   "PAUSE_PERIOD" 100
   "PAUSE_QUESTION" 100
   "PAUSE_EXCLAMATION" 100
   "PAUSE_SEMICOLON" 75
   "PAUSE_COLON" 75})

(def vowel-phonemes
  #{"A" "E" "I" "O" "U" "AA" "AE" "AH" "AO" "AW" "AX" "AY"
    "EH" "ER" "EY" "IH" "IX" "IY" "OW" "OY" "UH" "UW"})

(defn- pause-for-token [token]
  (case token
    "," "PAUSE_COMMA"
    ";" "PAUSE_SEMICOLON"
    ":" "PAUSE_COLON"
    "." "PAUSE_PERIOD"
    "?" "PAUSE_QUESTION"
    "!" "PAUSE_EXCLAMATION"
    "PAUSE_SPACE"))

(defn tokenize [text]
  (re-seq #"[A-Za-z]+|[,.;:!?]|\s+" (or text "")))

(defn word-to-phonemes [word]
  (loop [remaining (str/replace (str/lower-case (or word "")) #"[^a-z]" "")
         phonemes []]
    (if (empty? remaining)
      phonemes
      (let [match (some (fn [[pattern phones]]
                          (when-let [found (re-find pattern remaining)]
                            {:text found :phones phones}))
                        letter-patterns)]
        (if match
          (recur (subs remaining (count (:text match)))
                 (into phonemes (:phones match)))
          (recur (subs remaining 1) phonemes))))))

(defn extract-phonemes [text]
  (->> (tokenize text)
       (mapcat (fn [token]
                 (if (or (re-matches #"\s+" token) (re-matches #"[,.;:!?]" token))
                   [(pause-for-token token)]
                   (word-to-phonemes token))))
       vec))

(defn- normalize-phoneme [phoneme]
  (str/replace (str/upper-case (str phoneme)) #"[0-9]" ""))

(defn- vowel? [phoneme]
  (contains? vowel-phonemes (normalize-phoneme phoneme)))

(defn get-viseme-and-duration [phoneme]
  (if (str/starts-with? (str phoneme) "PAUSE_")
    {:phoneme phoneme
     :viseme (:B_M_P canonical-visemes)
     :duration (number-or (get pause-durations phoneme) 300)}
    (let [normalized (normalize-phoneme phoneme)
          viseme (get phoneme-to-viseme normalized (:B_M_P canonical-visemes))
          base-duration (or (get phoneme-durations normalized)
                            (if (vowel? normalized) 50 35))]
      {:phoneme normalized
       :viseme viseme
       :duration base-duration})))

(defn- adjust-duration [duration speech-rate]
  (.round js/Math (/ duration (max 0.01 (number-or speech-rate 1.0)))))

(defn phonemes-to-visemes
  ([phonemes] (phonemes-to-visemes phonemes 0 1.0))
  ([phonemes start-ms speech-rate]
   (loop [remaining phonemes
          current-time (number-or start-ms 0)
          events []]
     (if (empty? remaining)
       events
       (let [mapping (get-viseme-and-duration (first remaining))
             duration (adjust-duration (:duration mapping) speech-rate)
             event {:visemeId (:viseme mapping)
                    :offsetMs current-time
                    :durationMs duration}]
         (recur (rest remaining)
                (+ current-time duration)
                (conj events event)))))))

(defn word-to-visemes
  ([word] (word-to-visemes word 0 1.0))
  ([word start-ms speech-rate]
   (phonemes-to-visemes (word-to-phonemes word) start-ms speech-rate)))

(defn text-to-visemes
  ([text] (text-to-visemes text 1.0))
  ([text speech-rate]
   (loop [remaining (extract-phonemes text)
          current-time 0
          events []]
     (if (empty? remaining)
       events
       (let [mapping (get-viseme-and-duration (first remaining))
             duration (adjust-duration (:duration mapping) speech-rate)]
         (if (<= duration 0)
           (recur (rest remaining) current-time events)
           (recur (rest remaining)
                  (+ current-time duration)
                  (conj events {:visemeId (:viseme mapping)
                                :offsetMs current-time
                                :durationMs duration}))))))))

(def vowel-visemes
  #{(:AE canonical-visemes)
    (:Ah canonical-visemes)
    (:EE canonical-visemes)
    (:Er canonical-visemes)
    (:Ih canonical-visemes)
    (:Oh canonical-visemes)})

(defn- viseme-class [viseme-id]
  (cond
    (= viseme-id (:B_M_P canonical-visemes)) "bilabial"
    (= viseme-id (:W_OO canonical-visemes)) "glide"
    (contains? vowel-visemes viseme-id) "vowel"
    (contains? #{(:Ch_J canonical-visemes)
                 (:F_V canonical-visemes)
                 (:S_Z canonical-visemes)
                 (:Th canonical-visemes)}
               viseme-id) "fricative"
    (contains? #{(:K_G_H_NG canonical-visemes)
                 (:T_L_D_N canonical-visemes)}
               viseme-id) "tongue"
    (= viseme-id (:R canonical-visemes)) "liquid"
    :else "default"))

(defn- envelope-profile [viseme-id]
  (cond
    (= viseme-id (:W_OO canonical-visemes)) {:attackSec 0.018 :releaseSec 0.026 :peak 0.98}
    (= viseme-id (:Oh canonical-visemes)) {:attackSec 0.020 :releaseSec 0.026 :peak 0.96}
    (= viseme-id (:EE canonical-visemes)) {:attackSec 0.016 :releaseSec 0.020 :peak 0.94}
    (= viseme-id (:Ih canonical-visemes)) {:attackSec 0.014 :releaseSec 0.018 :peak 0.88}
    (= viseme-id (:F_V canonical-visemes)) {:attackSec 0.010 :releaseSec 0.016 :peak 0.86}
    (= viseme-id (:Th canonical-visemes)) {:attackSec 0.010 :releaseSec 0.016 :peak 0.82}
    (= viseme-id (:Ch_J canonical-visemes)) {:attackSec 0.012 :releaseSec 0.018 :peak 0.84}
    (= viseme-id (:S_Z canonical-visemes)) {:attackSec 0.010 :releaseSec 0.014 :peak 0.78}
    (= viseme-id (:K_G_H_NG canonical-visemes)) {:attackSec 0.010 :releaseSec 0.014 :peak 0.68}
    (= viseme-id (:T_L_D_N canonical-visemes)) {:attackSec 0.012 :releaseSec 0.016 :peak 0.80}
    :else (case (viseme-class viseme-id)
            "bilabial" {:attackSec 0.004 :releaseSec 0.006 :peak 1.0}
            "vowel" {:attackSec 0.018 :releaseSec 0.022 :peak 0.92}
            "fricative" {:attackSec 0.010 :releaseSec 0.014 :peak 0.72}
            "tongue" {:attackSec 0.012 :releaseSec 0.016 :peak 0.76}
            "liquid" {:attackSec 0.016 :releaseSec 0.018 :peak 0.82}
            "glide" {:attackSec 0.012 :releaseSec 0.018 :peak 0.84}
            {:attackSec 0.010 :releaseSec 0.012 :peak 0.86})))

(defn- deduplicate-curve [curve]
  (let [curve (vec curve)]
    (if (<= (count curve) 1)
      curve
      (loop [result [(first curve)]
             i 1]
        (if (>= i (count curve))
          (vec result)
          (let [prev (last result)
                curr (nth curve i)
                next-frame (when (< (inc i) (count curve)) (nth curve (inc i)))
                intensity-changed (> (abs-num (- (:intensity curr) (:intensity prev))) intensity-eps)
                ends-plateau (boolean
                              (and next-frame
                                   (> (abs-num (- (:intensity next-frame) (:intensity curr))) intensity-eps)))
                last? (= i (dec (count curve)))]
            (recur (if (or intensity-changed ends-plateau last?)
                     (conj result curr)
                     result)
                   (inc i))))))))

(defn- build-viseme-curve
  ([viseme-id start-ms duration-ms] (build-viseme-curve viseme-id start-ms duration-ms nil))
  ([viseme-id start-ms duration-ms peak-override]
   (let [start-sec (/ (number-or start-ms 0) 1000)
         duration-sec (/ (number-or duration-ms 0) 1000)
         end-sec (+ start-sec duration-sec)
         profile (envelope-profile viseme-id)
         peak (number-or peak-override (:peak profile))
         attack-sec (min (:attackSec profile) (* duration-sec 0.45))
         release-sec (min (:releaseSec profile) (* duration-sec 0.45))]
     (cond
       (<= duration-sec 0) []
       (<= duration-sec (+ attack-sec release-sec 0.002))
       [{:time start-sec :intensity 0}
        {:time (+ start-sec (* duration-sec 0.5)) :intensity peak}
        {:time end-sec :intensity 0}]

       (= (viseme-class viseme-id) "bilabial")
       (deduplicate-curve
        [{:time start-sec :intensity 0}
         {:time (+ start-sec attack-sec) :intensity peak}
         {:time (- end-sec release-sec) :intensity peak}
         {:time end-sec :intensity 0}])

       :else
       (deduplicate-curve
        [{:time start-sec :intensity 0}
         {:time (+ start-sec (* attack-sec envelope-shoulder-ratio))
          :intensity (* peak envelope-shoulder-intensity)}
         {:time (+ start-sec attack-sec) :intensity peak}
         {:time (- end-sec release-sec) :intensity peak}
         {:time (+ (- end-sec release-sec) (* release-sec (- 1 envelope-shoulder-ratio)))
          :intensity (* peak envelope-shoulder-intensity)}
         {:time end-sec :intensity 0}])))))

(defn- scale-lip-intensity [value intensity]
  (let [normalized (clamp 0 lip-dominant-cap value)
        scale (max 0 (number-or intensity 1))]
    (cond
      (<= (abs-num (- scale 1)) intensity-eps) normalized
      (<= scale 1) (* normalized scale)
      :else (- 1 (.pow js/Math (- 1 normalized) scale)))))

(defn- scale-curve-intensity [curve intensity]
  (if (or (empty? curve) (<= (abs-num (- (number-or intensity 1) 1)) intensity-eps))
    curve
    (mapv #(update % :intensity scale-lip-intensity intensity) curve)))

(defn- apply-constrained-coarticulation [curves events strength]
  (if (or (<= strength 0) (< (count events) 2))
    curves
    (let [blended (atom (into {} (map (fn [[key curve]] [key (mapv identity curve)]) curves)))]
      (doseq [i (range (dec (count events)))]
        (let [current (nth events i)
              next-event (nth events (inc i))
              current-class (viseme-class (:visemeId current))
              next-class (viseme-class (:visemeId next-event))
              current-end (+ (:offsetMs current) (:durationMs current))
              next-start (:offsetMs next-event)
              gap (- next-start current-end)]
          (when (and (< gap 50) (> gap -30)
                     (not= current-class "bilabial")
                     (not= next-class "bilabial"))
            (let [current-key (str (:visemeId current))
                  next-key (str (:visemeId next-event))
                  can-carry-current (contains? #{"vowel" "liquid" "glide"} current-class)
                  can-anticipate-next (contains? #{"vowel" "liquid" "glide"} next-class)]
              (when-let [curve (and can-carry-current (get @blended current-key))]
                (let [last-idx (dec (count curve))]
                  (when (>= last-idx 0)
                    (let [extend-sec (* 0.010 strength)
                          max-end-sec (max (get-in curve [last-idx :time]) (/ next-start 1000))
                          next-time (min max-end-sec (+ (get-in curve [last-idx :time]) extend-sec))]
                      (swap! blended assoc-in [current-key last-idx :time] next-time)))))
              (when-let [curve (and can-anticipate-next (get @blended next-key))]
                (when (seq curve)
                  (let [anticipate-sec (* 0.016 strength)
                        next-time (max 0 (- (get-in curve [0 :time]) anticipate-sec))]
                    (swap! blended assoc-in [next-key 0 :time] next-time))))))))
      @blended)))

(defn- sample-curve-at [curve time]
  (cond
    (empty? curve) 0
    (<= time (:time (first curve))) (:intensity (first curve))
    (>= time (:time (last curve))) (:intensity (last curve))
    :else
    (loop [i 0]
      (if (>= i (dec (count curve)))
        0
        (let [a (nth curve i)
              b (nth curve (inc i))]
          (if (and (>= time (:time a)) (<= time (:time b)))
            (let [span (max 0.000001 (- (:time b) (:time a)))
                  progress (/ (- time (:time a)) span)]
              (+ (:intensity a) (* (- (:intensity b) (:intensity a)) progress)))
            (recur (inc i))))))))

(defn- rounded-sec [time]
  (/ (.round js/Math (* time 1000)) 1000))

(defn- add-sample-time [times time]
  (if (and (finite-number? time) (>= time 0))
    (conj times (rounded-sec time))
    times))

(defn- collect-lip-sample-times [curves]
  (let [frame-times (reduce-kv
                     (fn [times key curve]
                       (if (= key jaw-au)
                         times
                         (reduce (fn [acc frame] (add-sample-time acc (:time frame))) times curve)))
                     #{}
                     curves)
        sorted (vec (sort frame-times))
        with-midpoints (reduce
                        (fn [times i]
                          (let [start (nth sorted i)
                                end (nth sorted (inc i))]
                            (if (<= (- end start) 0.12)
                              (add-sample-time times (/ (+ start end) 2))
                              times)))
                        frame-times
                        (range (max 0 (dec (count sorted)))))]
    (vec (sort with-midpoints))))

(defn- fit-secondary-activation [active adjusted budget]
  (let [secondary (subvec (vec active) 1)
        secondary-sum (reduce + (map :value secondary))]
    (if (or (empty? secondary) (<= secondary-sum budget))
      adjusted
      (let [scale (/ budget secondary-sum)]
        (reduce (fn [next-adjusted entry]
                  (assoc next-adjusted (:key entry) (* (:value entry) scale)))
                adjusted
                secondary)))))

(defn- trim-inactive-padding [curve]
  (let [curve (vec curve)
        first-active (.findIndex (clj->js curve)
                                 (fn [frame]
                                   (> (aget frame "intensity") intensity-eps)))]
    (if (neg? first-active)
      []
      (let [last-active (loop [i (dec (count curve))]
                          (if (or (neg? i) (> (:intensity (nth curve i)) intensity-eps))
                            i
                            (recur (dec i))))
            start (max 0 (dec first-active))
            end (min (dec (count curve)) (inc last-active))]
        (subvec curve start (inc end))))))

(defn- limit-concurrent-lip-activation [curves]
  (let [lip-keys (vec (remove #(= % jaw-au) (keys curves)))]
    (if (<= (count lip-keys) 1)
      curves
      (let [sample-times (collect-lip-sample-times curves)]
        (if (empty? sample-times)
          curves
          (let [normalized
                (reduce
                 (fn [acc time]
                   (let [values (mapv (fn [key]
                                        {:key key
                                         :visemeId (js/parseInt key 10)
                                         :value (clamp 0 lip-dominant-cap (sample-curve-at (get curves key) time))})
                                      lip-keys)
                         active (vec (sort-by (comp - :value)
                                              (filter #(> (:value %) intensity-eps) values)))
                         adjusted (into {} (map (juxt :key :value) values))
                         adjusted (if (> (count active) 1)
                                    (let [dominant (first active)]
                                      (if (and (= (:visemeId dominant) (:B_M_P canonical-visemes))
                                               (>= (:value dominant) closure-dominance-threshold))
                                        (fit-secondary-activation active adjusted closure-secondary-cap)
                                        (let [total (reduce + (map :value active))]
                                          (if (> total lip-total-activation-cap)
                                            (let [budget (max 0
                                                              (min (- lip-total-activation-cap (:value dominant))
                                                                   (* (:value dominant) lip-secondary-ratio)
                                                                   lip-secondary-cap))]
                                              (fit-secondary-activation active adjusted budget))
                                            adjusted))))
                                    adjusted)]
                     (reduce (fn [acc* key]
                               (update acc* key conj {:time time :intensity (get adjusted key 0)}))
                             acc
                             lip-keys)))
                 (zipmap lip-keys (repeat []))
                 sample-times)]
            (into {}
                  (map (fn [key]
                         [key (trim-inactive-padding (deduplicate-curve (get normalized key)))])
                       lip-keys))))))))

(defn- reduce-curve-keys [viseme-id curve]
  (let [curve (vec curve)]
    (if (<= (count curve) 3)
      curve
      (let [profile (envelope-profile viseme-id)]
        (loop [reduced [(first curve)]
               i 1]
          (if (>= i (dec (count curve)))
            (conj reduced (last curve))
            (let [prev (last reduced)
                  curr (nth curve i)
                  next-frame (nth curve (inc i))
                  preserves-peak (>= (:intensity curr) (- (:peak profile) 0.02))
                  preserves-closure (and (= viseme-id (:B_M_P canonical-visemes))
                                         (>= (:intensity curr) 0.98))
                  near-flat (and (< (abs-num (- (:intensity curr) (:intensity prev))) 0.015)
                                 (< (abs-num (- (:intensity next-frame) (:intensity curr))) 0.015))]
              (recur (if (or (not near-flat) preserves-peak preserves-closure)
                       (conj reduced curr)
                       reduced)
                     (inc i)))))))))

(defn- reduce-lip-keys [curves]
  (into {}
        (map (fn [[key curve]]
               (let [sorted-curve (vec (sort-by :time curve))]
                 [key (if (= key jaw-au)
                        (deduplicate-curve sorted-curve)
                        (reduce-curve-keys (js/parseInt key 10) (deduplicate-curve sorted-curve)))]))
        curves)))

(defn- push-jaw-frame [curve time intensity]
  (if (or (not (finite-number? time)) (not (finite-number? intensity)))
    curve
    (let [frame {:time (max 0 time)
                 :intensity (clamp 0 2 intensity)}
          previous (last curve)]
      (if (and previous (< (abs-num (- (:time previous) (:time frame))) 0.001))
        (assoc-in curve [(dec (count curve)) :intensity] (:intensity frame))
        (conj curve frame)))))

(defn- jaw-amount-for-viseme [viseme-id]
  (number-or (get jaw-amounts viseme-id) 0.3))

(defn- build-jaw-curve [events jaw-scale]
  (let [events (vec (sort-by :offsetMs events))]
    (loop [i 0
           jaw-curve []]
      (if (>= i (count events))
        (deduplicate-curve (vec (sort-by :time jaw-curve)))
        (let [event (nth events i)
              previous (when (pos? i) (nth events (dec i)))
              next-event (when (< (inc i) (count events)) (nth events (inc i)))
              start-sec (/ (:offsetMs event) 1000)
              duration-sec (/ (:durationMs event) 1000)
              end-sec (+ start-sec duration-sec)
              jaw-amount (min 2 (* (jaw-amount-for-viseme (:visemeId event)) jaw-scale))
              attack-sec (min jaw-attack-sec (max 0.006 (* duration-sec 0.35)))
              release-sec (min jaw-release-sec (max 0.010 (* duration-sec 0.45)))
              previous-end-sec (if previous (/ (+ (:offsetMs previous) (:durationMs previous)) 1000) 0)
              starts-after-gap? (or (nil? previous) (> (- start-sec previous-end-sec) jaw-long-gap-sec))
              jaw-curve (cond-> jaw-curve
                          starts-after-gap? (push-jaw-frame start-sec 0))
              jaw-curve (push-jaw-frame jaw-curve (+ start-sec attack-sec) jaw-amount)
              jaw-curve (if next-event
                          (let [next-start-sec (/ (:offsetMs next-event) 1000)
                                gap-sec (- next-start-sec end-sec)]
                            (if (> gap-sec jaw-long-gap-sec)
                              (-> jaw-curve
                                  (push-jaw-frame (max (+ start-sec attack-sec) (- end-sec release-sec)) jaw-amount)
                                  (push-jaw-frame end-sec 0))
                              (push-jaw-frame jaw-curve
                                              (max (+ start-sec attack-sec)
                                                   (- next-start-sec jaw-transition-lead-sec))
                                              jaw-amount)))
                          (-> jaw-curve
                              (push-jaw-frame (max (+ start-sec attack-sec) (- end-sec release-sec)) jaw-amount)
                              (push-jaw-frame end-sec 0)))]
          (recur (inc i) jaw-curve))))))

(defn- normalize-viseme-event [event]
  {:visemeId (int (clamp 0 14 (:visemeId event)))
   :offsetMs (max 0 (number-or (:offsetMs event) 0))
   :durationMs (max 0 (number-or (:durationMs event) 0))})

(defn build-vocal-snippet
  ([events] (build-vocal-snippet events nil nil))
  ([events config name]
   (let [cfg (merge default-config (or config {}))
         events (mapv normalize-viseme-event (or events []))
         snippet-name (or name (str "vocal_" (now)))
         priority (number-or (:priority cfg) 50)
         jaw-scale (number-or (:jawScale cfg) 1.0)]
     (if (empty? events)
       {:name snippet-name
        :snippetCategory vocal-snippet-category
        :snippetPriority priority
        :snippetPlaybackRate 1.0
        :snippetIntensityScale 1.0
        :snippetJawScale jaw-scale
        :loop false
        :maxTime 0
        :curves {}}
       (let [curves (reduce
                     (fn [acc event]
                       (let [key (str (:visemeId event))
                             curve (scale-curve-intensity
                                    (build-viseme-curve (:visemeId event) (:offsetMs event) (:durationMs event))
                                    (:intensity cfg))]
                         (if (empty? curve)
                           acc
                           (update acc key
                                   (fn [existing]
                                     (deduplicate-curve (sort-by :time (concat (or existing []) curve))))))))
                     {}
                     events)
             articulated-curves (reduce-lip-keys
                                 (limit-concurrent-lip-activation
                                  (apply-constrained-coarticulation curves events coarticulation-strength)))
             jaw-curve (build-jaw-curve events jaw-scale)
             articulated-curves (if (seq jaw-curve)
                                  (assoc articulated-curves jaw-au jaw-curve)
                                  articulated-curves)
             event-max (apply max (map #(/ (+ (:offsetMs %) (:durationMs %)) 1000) events))
             curve-max (if (seq articulated-curves)
                         (apply max (mapcat (fn [[_ curve]] (map :time curve)) articulated-curves))
                         0)
             max-time (max event-max curve-max)]
         {:name snippet-name
          :snippetCategory vocal-snippet-category
          :snippetPriority priority
          :snippetPlaybackRate 1.0
          :snippetIntensityScale 1.0
          :snippetJawScale jaw-scale
          :autoVisemeJaw false
          :loop false
          :maxTime max-time
          :curves articulated-curves})))))

(defn- slug-text [text]
  (let [words (->> (str/split (or text "") #"\s+")
                   (remove empty?)
                   (take 3)
                   (str/join "_")
                   str/lower-case)]
    (str/replace words #"[^a-z_]" "")))

(defn- text-snippet-name [text]
  (str "vocal_" (or (not-empty (slug-text text)) "text") "_" (now)))

(defn- timeline-name [timeline]
  (or (:name timeline)
      (when (seq (str/trim (or (:text timeline) "")))
        (text-snippet-name (:text timeline)))
      (str "vocal_" (or (:source timeline) "external") "_" (now))))

(defn- build-word-timings [text speech-rate]
  (loop [words (remove empty? (str/split (or text "") #"\s+"))
         current-time 0
         timings []]
    (if (empty? words)
      timings
      (let [word (first words)
            events (word-to-visemes word 0 speech-rate)
            duration (if (seq events)
                       (/ (reduce max (map #(+ (:offsetMs %) (:durationMs %)) events)) 1000)
                       0.2)]
        (recur (rest words)
               (+ current-time duration)
               (conj timings {:word word
                               :startSec current-time
                               :endSec (+ current-time duration)}))))))

(defn- normalize-word-timings [word-timings]
  (->> (or word-timings [])
       (filter (fn [timing]
                 (and (seq (:word timing))
                      (finite-number? (:startSec timing))
                      (finite-number? (:endSec timing)))))
       (mapv (fn [timing]
               (let [start (max 0 (:startSec timing))]
                 {:word (:word timing)
                  :startSec start
                  :endSec (max start (:endSec timing))})))))

(defn- active-with [active name]
  (vec (distinct (conj (vec active) name))))

(defn- active-without [active name]
  (vec (remove #(= % name) active)))

(defn start-timeline! [state timeline]
  (let [timeline (or timeline {})
        config (:config @state)
        events (mapv normalize-viseme-event (:visemes timeline))]
    (if (empty? events)
      (result nil [(event-output {:type "TIMELINE_EMPTY"})
                   (state-output state)])
      (let [previous-name (get-in @state [:currentSentence :name])
            snippet-name (timeline-name timeline)
            snippet (build-vocal-snippet events (assoc config :speechRate 1.0) snippet-name)
            duration-sec (:durationSec timeline)
            snippet (if (finite-number? duration-sec)
                      (assoc snippet :maxTime (max (:maxTime snippet) (max 0 duration-sec)))
                      snippet)
            word-timings (normalize-word-timings (:wordTimings timeline))
            sentence {:name (:name snippet)
                      :text (or (:text timeline) (:name timeline) (str (or (:source timeline) "external") "_visemes"))
                      :startTime (protocol/now-ms)
                      :maxTime (:maxTime snippet)
                      :wordIndex 0
                      :wordTimings word-timings}]
        (update-state!
         state
         #(-> %
              (assoc :isSpeaking true
                     :currentWord nil
                     :currentViseme (:visemeId (first events))
                     :snippetName (:name snippet)
                     :startTime (:startTime sentence)
                     :currentSentence sentence)
              (update :activeSnippets active-with (:name snippet))))
        (result (:name snippet)
                (vec (concat
                      (when previous-name
                        [(protocol/emit-remove-snippet agency-name previous-name)])
                      [(protocol/emit-schedule-snippet agency-name snippet {:autoPlay true})
                       (cleanup-plan-output (:name snippet) (:maxTime snippet))
                       (event-output {:type "START_TIMELINE"
                                      :snippetName (:name snippet)
                                      :source (:source timeline)})
                       (state-output state)])))))))

(defn start-sentence! [state text]
  (let [text (or text "")
        trimmed (str/trim text)]
    (if (empty? trimmed)
      (result nil [(event-output {:type "SENTENCE_EMPTY"})
                   (state-output state)])
      (let [speech-rate (number-or (get-in @state [:config :speechRate]) 1.0)
            events (text-to-visemes trimmed speech-rate)]
        (if (empty? events)
          (result nil [(event-output {:type "SENTENCE_NO_VISEMES" :text trimmed})
                       (state-output state)])
          (start-timeline! state {:name (text-snippet-name trimmed)
                                  :text trimmed
                                  :visemes events
                                  :wordTimings (build-word-timings trimmed speech-rate)
                                  :source "text"}))))))

(defn update-word-timings! [state word-timings]
  (update-state! state #(assoc-in % [:currentSentence :wordTimings] (normalize-word-timings word-timings)))
  (result true [(event-output {:type "WORD_TIMINGS_UPDATED"})
                (state-output state)]))

(defn on-word-boundary! [state word word-index observed-elapsed-sec]
  (let [sentence (:currentSentence @state)]
    (if-not sentence
      (result false [(event-output {:type "WORD_BOUNDARY_WITHOUT_SENTENCE" :word word})
                     (state-output state)])
      (let [expected-index (if (finite-number? word-index)
                             (int word-index)
                             (:wordIndex sentence))
            expected (get (:wordTimings sentence) expected-index)
            elapsed-sec (if (finite-number? observed-elapsed-sec)
                          (max 0 observed-elapsed-sec)
                          (/ (- (protocol/now-ms) (:startTime sentence)) 1000))
            drift (when expected (- elapsed-sec (:startSec expected)))
            should-seek? (and drift (> (abs-num drift) word-sync-drift-threshold-sec))
            target-time (min (:maxTime sentence) (max 0 elapsed-sec))]
        (update-state!
         state
         #(-> %
              (assoc :currentWord word)
              (assoc-in [:currentSentence :wordIndex] (inc expected-index))))
        (result true
                (vec (concat
                      (when should-seek?
                        [(seek-output (:name sentence) target-time)])
                      [(event-output {:type "WORD_BOUNDARY"
                                      :word word
                                      :wordIndex expected-index
                                      :elapsedSec elapsed-sec
                                      :driftSec drift
                                      :seeked should-seek?})
                       (state-output state)])))))))

(defn stop-sentence! [state]
  (let [name (get-in @state [:currentSentence :name])]
    (if-not name
      (result false [(state-output state)])
      (do
        (update-state!
         state
         #(-> %
              (assoc :isSpeaking false
                     :currentWord nil
                     :currentViseme nil
                     :snippetName nil
                     :startTime nil
                     :currentSentence nil)
              (update :activeSnippets active-without name)))
        (result true [(protocol/emit-remove-snippet agency-name name)
                      (event-output {:type "STOP_SENTENCE" :snippetName name})
                      (state-output state)])))))

(defn cleanup! [state name]
  (let [name (or name (get-in @state [:currentSentence :name]))]
    (if-not name
      (result false [])
      (let [was-current? (= name (get-in @state [:currentSentence :name]))]
        (update-state!
         state
         #(cond-> (update % :activeSnippets active-without name)
            was-current? (assoc :isSpeaking false
                                :currentWord nil
                                :currentViseme nil
                                :snippetName nil
                                :startTime nil
                                :currentSentence nil)))
        (result true [(protocol/emit-remove-snippet agency-name name)
                      (event-output {:type "CLEANUP" :snippetName name})
                      (state-output state)])))))

(defn stop! [state]
  (let [names (:activeSnippets @state)]
    (update-state!
     state
     #(assoc % :isSpeaking false
             :currentWord nil
             :currentViseme nil
             :snippetName nil
             :startTime nil
             :currentSentence nil
             :activeSnippets []))
    (result true
            (vec (concat
                  (map #(protocol/emit-remove-snippet agency-name %) names)
                  [(event-output {:type "STOP"})
                   (state-output state)])))))

(defn pause-sentence! [state]
  (let [name (get-in @state [:currentSentence :name])]
    (result (boolean name)
            (cond-> []
              name (conj (pause-output name)
                         (event-output {:type "PAUSE_SENTENCE" :snippetName name})
                         (state-output state))))))

(defn resume-sentence! [state]
  (let [name (get-in @state [:currentSentence :name])]
    (result (boolean name)
            (cond-> []
              name (conj (resume-output name)
                         (event-output {:type "RESUME_SENTENCE" :snippetName name})
                         (state-output state))))))

(defn speak-word! [state word]
  (if (:currentSentence @state)
    (on-word-boundary! state word nil nil)
    (start-sentence! state word)))

(defn process-word-boundary! [state timing]
  (if (:currentSentence @state)
    (on-word-boundary! state (:word timing) nil (/ (number-or (:startMs timing) 0) 1000))
    (start-sentence! state (:word timing))))

(defn process-viseme-events! [state events name]
  (start-timeline! state {:name name
                          :visemes events
                          :source "azure"}))

(defn update-config! [state config]
  (update-state! state #(update % :config merge (normalize-config config)))
  (result true [(event-output {:type "CONFIG_UPDATED"})
                (state-output state)]))

(defn handle-command! [state command]
  (case (:type command)
    "updateConfig" (update-config! state (:config command))
    "configure" (update-config! state (:config command))
    "startSentence" (start-sentence! state (:text command))
    "startTimeline" (start-timeline! state (:timeline command))
    "onWordBoundary" (on-word-boundary! state (:word command) (:wordIndex command) (:observedElapsedSec command))
    "updateWordTimings" (update-word-timings! state (:wordTimings command))
    "stopSentence" (stop-sentence! state)
    "pauseSentence" (pause-sentence! state)
    "resumeSentence" (resume-sentence! state)
    "speak" (start-sentence! state (:text command))
    "speakWord" (speak-word! state (:word command))
    "processWordBoundary" (process-word-boundary! state (:timing command))
    "processVisemeEvents" (process-viseme-events! state (:events command) (:name command))
    "cleanup" (cleanup! state (:name command))
    "stop" (stop! state)
    (result false [(protocol/emit-error agency-name (str "Unsupported vocal command: " (:type command)))])))
