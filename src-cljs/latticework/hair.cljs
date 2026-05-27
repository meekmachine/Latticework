(ns latticework.hair
  (:require [latticework.protocol :as protocol]))

(def agency-name "hair")

(def hair-color-presets
  {:natural_black {:name "Natural Black"
                   :baseColor "#1a1a1a"
                   :emissive "#000000"
                   :emissiveIntensity 0}
   :natural_brown {:name "Natural Brown"
                   :baseColor "#4a3728"
                   :emissive "#000000"
                   :emissiveIntensity 0}
   :natural_blonde {:name "Natural Blonde"
                    :baseColor "#e6c78a"
                    :emissive "#000000"
                    :emissiveIntensity 0}
   :natural_red {:name "Natural Red"
                 :baseColor "#8b3a3a"
                 :emissive "#000000"
                 :emissiveIntensity 0}
   :natural_gray {:name "Natural Gray"
                  :baseColor "#9e9e9e"
                  :emissive "#000000"
                  :emissiveIntensity 0}
   :natural_white {:name "Natural White"
                   :baseColor "#f5f5f5"
                   :emissive "#000000"
                   :emissiveIntensity 0}
   :neon_blue {:name "Neon Blue"
               :baseColor "#00ffff"
               :emissive "#0000ff"
               :emissiveIntensity 0.8}
   :neon_pink {:name "Neon Pink"
               :baseColor "#ff00ff"
               :emissive "#ff1493"
               :emissiveIntensity 0.8}
   :neon_green {:name "Neon Green"
                :baseColor "#00ff00"
                :emissive "#00ff00"
                :emissiveIntensity 0.8}
   :electric_purple {:name "Electric Purple"
                     :baseColor "#9d00ff"
                     :emissive "#9d00ff"
                     :emissiveIntensity 0.6}
   :fire_orange {:name "Fire Orange"
                 :baseColor "#ff6600"
                 :emissive "#ff3300"
                 :emissiveIntensity 0.7}})

(def default-hair-state
  {:hairColor (:natural_brown hair-color-presets)
   :eyebrowColor (:natural_brown hair-color-presets)
   :showOutline false
   :outlineColor "#00ff00"
   :outlineOpacity 1.0
   :parts {}})

(def physics-keys
  [:stiffness
   :damping
   :inertia
   :gravity
   :responseScale
   :idleSwayAmount
   :idleSwaySpeed
   :windStrength
   :windDirectionX
   :windDirectionZ
   :windTurbulence
   :windFrequency
   :idleClipDuration
   :impulseClipDuration])

(def default-physics-config
  {:stiffness 7.5
   :damping 0.18
   :inertia 3.5
   :gravity 12
   :responseScale 2.5
   :idleSwayAmount 0.12
   :idleSwaySpeed 1.0
   :windStrength 0
   :windDirectionX 1.0
   :windDirectionZ 0
   :windTurbulence 0.3
   :windFrequency 1.4
   :idleClipDuration 10
   :impulseClipDuration 1.4})

(def default-state
  {:hairState default-hair-state
   :objects []
   :physics {:enabled false
             :config default-physics-config}
   :lastUpdatedTime nil})

(def hair-state-keys
  #{:hairColor
    :eyebrowColor
    :showOutline
    :outlineColor
    :outlineOpacity
    :parts})

(defn- key->string [key]
  (cond
    (keyword? key) (name key)
    (string? key) key
    :else (str key)))

(defn- contains-key? [data key]
  (and (map? data) (contains? data key)))

(defn- preset-color [value]
  (cond
    (keyword? value) (get hair-color-presets value)
    (string? value) (get hair-color-presets (keyword value))
    :else nil))

(defn normalize-color [color fallback]
  (cond
    (preset-color color) (preset-color color)
    (map? color) (merge fallback (select-keys color [:name :baseColor :emissive :emissiveIntensity]))
    :else fallback))

(defn- normalize-position [position]
  (when (sequential? position)
    (let [values (vec position)]
      [(protocol/maybe-number (nth values 0 nil) 0)
       (protocol/maybe-number (nth values 1 nil) 0)
       (protocol/maybe-number (nth values 2 nil) 0)])))

(defn- normalize-part [part-name part]
  (let [part (or part {})
        normalized (cond-> {:name (key->string (or (:name part) part-name))
                            :visible (if (contains-key? part :visible)
                                       (boolean (:visible part))
                                       true)}
                     (number? (:scale part))
                     (assoc :scale (:scale part))

                     (normalize-position (:position part))
                     (assoc :position (normalize-position (:position part))))]
    normalized))

(defn normalize-parts [parts]
  (if (map? parts)
    (into {}
          (map (fn [[part-name part]]
                 (let [part-name (key->string part-name)]
                   [part-name (normalize-part part-name part)])))
          parts)
    {}))

(defn normalize-hair-state
  ([state] (normalize-hair-state default-hair-state state))
  ([fallback state]
   (let [fallback (merge default-hair-state (or fallback {}))
         state (or state {})]
     (-> fallback
         (assoc :hairColor (normalize-color (:hairColor state) (:hairColor fallback))
                :eyebrowColor (normalize-color (:eyebrowColor state) (:eyebrowColor fallback))
               :showOutline (if (contains-key? state :showOutline)
                              (boolean (:showOutline state))
                              (:showOutline fallback))
               :outlineColor (or (:outlineColor state) (:outlineColor fallback))
               :outlineOpacity (protocol/maybe-number (:outlineOpacity state)
                                                      (:outlineOpacity fallback))
               :parts (if (contains-key? state :parts)
                        (merge (:parts fallback) (normalize-parts (:parts state)))
                        (:parts fallback)))))))

(defn normalize-object [object]
  (when (and (map? object) (:name object))
    {:name (key->string (:name object))
     :isEyebrow (boolean (:isEyebrow object))
     :isMesh (if (contains-key? object :isMesh)
               (boolean (:isMesh object))
               true)}))

(defn normalize-objects [objects]
  (if (sequential? objects)
    (->> objects
         (map normalize-object)
         (remove nil?)
         vec)
    []))

(defn normalize-physics-config [config]
  (let [config (or config {})]
    (reduce
     (fn [normalized key]
       (if (number? (get config key))
         (assoc normalized key (get config key))
         normalized))
     default-physics-config
     physics-keys)))

(defn- has-hair-state? [config]
  (or (contains-key? config :hairState)
      (contains-key? config :state)
      (some #(contains-key? config %) hair-state-keys)))

(defn- has-physics-config? [config]
  (or (contains-key? config :physics)
      (contains-key? config :physicsConfig)
      (contains-key? config :physicsEnabled)
      (some #(contains-key? config %) physics-keys)))

(defn- config-hair-state [config]
  (cond
    (contains-key? config :hairState) (:hairState config)
    (contains-key? config :state) (:state config)
    :else (select-keys config hair-state-keys)))

(defn- config-physics-config [config]
  (let [physics (:physics config)]
    (cond
      (contains-key? config :physicsConfig) (:physicsConfig config)
      (map? physics) (merge physics (:config physics))
      :else (select-keys config physics-keys))))

(defn- config-physics-enabled [config fallback]
  (let [physics (:physics config)]
    (cond
      (contains-key? config :physicsEnabled) (boolean (:physicsEnabled config))
      (and (map? physics) (contains-key? physics :enabled)) (boolean (:enabled physics))
      :else fallback)))

(defn normalize-config [config]
  (let [config (or config {})
        physics-config (config-physics-config config)]
    (-> default-state
        (assoc :hairState (normalize-hair-state (config-hair-state config))
               :objects (normalize-objects (:objects config))
               :physics {:enabled (config-physics-enabled config false)
                         :config (normalize-physics-config physics-config)}))))

(defn create-state
  ([] (create-state nil))
  ([config]
   (atom (normalize-config config))))

(defn snapshot [state]
  @state)

(defn hair-snapshot [state]
  (:hairState @state))

(defn physics-snapshot [state]
  (:physics @state))

(defn- part-state [hair-state object-name]
  (get-in hair-state [:parts object-name]))

(defn- vector->xyz [values]
  (when (sequential? values)
    (let [values (vec values)]
      {:x (protocol/maybe-number (nth values 0 nil) 0)
       :y (protocol/maybe-number (nth values 1 nil) 0)
       :z (protocol/maybe-number (nth values 2 nil) 0)})))

(defn build-object-state [hair-state object]
  (when (:isMesh object)
    (let [object-name (:name object)
          part (part-state hair-state object-name)
          color (if (:isEyebrow object) (:eyebrowColor hair-state) (:hairColor hair-state))]
      (cond-> {:color {:baseColor (:baseColor color)
                       :emissive (:emissive color)
                       :emissiveIntensity (:emissiveIntensity color)}
               :outline {:show (:showOutline hair-state)
                         :color (:outlineColor hair-state)
                         :opacity (:outlineOpacity hair-state)}
               :visible (if (contains-key? part :visible) (:visible part) true)
               :isEyebrow (:isEyebrow object)}
        (number? (:scale part))
        (assoc :scale {:x (:scale part)
                       :y (:scale part)
                       :z (:scale part)})

        (vector->xyz (:position part))
        (assoc :position (vector->xyz (:position part)))))))

(defn build-object-states [agency-state]
  (let [hair-state (:hairState agency-state)]
    (->> (:objects agency-state)
         (keep (fn [object]
                 (when-let [object-state (build-object-state hair-state object)]
                   {:name (:name object)
                    :objectState object-state})))
         vec)))

(defn emit-apply-hair-state [agency-state]
  {:type "applyHairState"
   :agency agency-name
   :state (:hairState agency-state)
   :objects (:objects agency-state)
   :objectStates (build-object-states agency-state)})

(defn emit-apply-physics [agency-state]
  {:type "applyHairPhysics"
   :agency agency-name
   :enabled (get-in agency-state [:physics :enabled])
   :config (get-in agency-state [:physics :config])})

(defn- state-output [agency-state]
  (protocol/emit-state agency-name agency-state))

(defn- now []
  (.round js/Math (protocol/now-ms)))

(defn- apply-hair-update! [state update-fn]
  (swap! state
         (fn [current]
           (-> current
               (update :hairState update-fn)
               (assoc :lastUpdatedTime (now)))))
  [(emit-apply-hair-state @state)
   (state-output @state)])

(defn- ensure-part [hair-state part-name]
  (update-in hair-state
             [:parts part-name]
             #(merge {:name part-name :visible true} %)))

(defn configure! [state config]
  (let [config (or config {})
        hair? (has-hair-state? config)
        objects? (contains-key? config :objects)
        physics? (has-physics-config? config)]
    (swap! state
           (fn [current]
             (cond-> current
               hair?
               (assoc :hairState (normalize-hair-state
                                   (if (or (contains-key? config :hairState)
                                           (contains-key? config :state))
                                     default-hair-state
                                     (:hairState current))
                                   (config-hair-state config)))

               objects?
               (assoc :objects (normalize-objects (:objects config)))

               physics?
               (assoc :physics {:enabled (config-physics-enabled config (get-in current [:physics :enabled]))
                                :config (normalize-physics-config
                                         (merge (get-in current [:physics :config])
                                                (config-physics-config config)))})

               (or hair? objects? physics?)
               (assoc :lastUpdatedTime (now)))))
    (cond-> []
      hair? (conj (emit-apply-hair-state @state))
      physics? (conj (emit-apply-physics @state))
      true (conj (state-output @state)))))

(defn register-objects! [state objects]
  (swap! state assoc :objects (normalize-objects objects))
  [(state-output @state)])

(defn set-hair-color! [state color]
  (apply-hair-update!
   state
   #(assoc % :hairColor (normalize-color color (:hairColor %)))))

(defn set-eyebrow-color! [state color]
  (apply-hair-update!
   state
   #(assoc % :eyebrowColor (normalize-color color (:eyebrowColor %)))))

(defn set-hair-base-color! [state base-color]
  (apply-hair-update!
   state
   #(assoc-in % [:hairColor :baseColor] base-color)))

(defn set-eyebrow-base-color! [state base-color]
  (apply-hair-update!
   state
   #(assoc-in % [:eyebrowColor :baseColor] base-color)))

(defn set-hair-glow! [state emissive intensity]
  (apply-hair-update!
   state
   #(-> %
        (assoc-in [:hairColor :emissive] emissive)
        (assoc-in [:hairColor :emissiveIntensity] (protocol/maybe-number intensity 0)))))

(defn set-eyebrow-glow! [state emissive intensity]
  (apply-hair-update!
   state
   #(-> %
        (assoc-in [:eyebrowColor :emissive] emissive)
        (assoc-in [:eyebrowColor :emissiveIntensity] (protocol/maybe-number intensity 0)))))

(defn set-outline! [state show color opacity]
  (apply-hair-update!
   state
   (fn [hair-state]
     (cond-> (assoc hair-state :showOutline (boolean show))
       (some? color) (assoc :outlineColor color)
       (number? opacity) (assoc :outlineOpacity opacity)))))

(defn set-part-visibility! [state part-name visible]
  (let [part-name (key->string part-name)]
    (apply-hair-update!
     state
     #(-> %
          (ensure-part part-name)
          (assoc-in [:parts part-name :visible] (boolean visible))))))

(defn set-part-scale! [state part-name scale]
  (let [part-name (key->string part-name)]
    (apply-hair-update!
     state
     #(-> %
          (ensure-part part-name)
          (assoc-in [:parts part-name :scale] (protocol/maybe-number scale 1))))))

(defn set-part-position! [state part-name position]
  (let [part-name (key->string part-name)
        position (or (normalize-position position) [0 0 0])]
    (apply-hair-update!
     state
     #(-> %
          (ensure-part part-name)
          (assoc-in [:parts part-name :position] position)))))

(defn reset-to-default! [state]
  (swap! state assoc :hairState default-hair-state :lastUpdatedTime (now))
  [(emit-apply-hair-state @state)
   (state-output @state)])

(defn set-physics-enabled! [state enabled]
  (swap! state assoc-in [:physics :enabled] (boolean enabled))
  (swap! state assoc :lastUpdatedTime (now))
  [(emit-apply-physics @state)
   (state-output @state)])

(defn update-physics-config! [state config]
  (swap! state
         (fn [current]
           (-> current
               (assoc-in [:physics :config]
                         (normalize-physics-config
                          (merge (get-in current [:physics :config]) (or config {}))))
               (assoc :lastUpdatedTime (now)))))
  [(emit-apply-physics @state)
   (state-output @state)])

(defn- dispatch-event! [state event]
  (case (:type event)
    "SET_HAIR_COLOR" (set-hair-color! state (:color event))
    "SET_EYEBROW_COLOR" (set-eyebrow-color! state (:color event))
    "SET_HAIR_BASE_COLOR" (set-hair-base-color! state (:baseColor event))
    "SET_EYEBROW_BASE_COLOR" (set-eyebrow-base-color! state (:baseColor event))
    "SET_HAIR_GLOW" (set-hair-glow! state (:emissive event) (:intensity event))
    "SET_EYEBROW_GLOW" (set-eyebrow-glow! state (:emissive event) (:intensity event))
    "SET_OUTLINE" (set-outline! state (:show event) (:color event) (:opacity event))
    "SET_PART_VISIBILITY" (set-part-visibility! state (:partName event) (:visible event))
    "SET_PART_SCALE" (set-part-scale! state (:partName event) (:scale event))
    "SET_PART_POSITION" (set-part-position! state (:partName event) (:position event))
    "RESET_TO_DEFAULT" (reset-to-default! state)
    [(protocol/emit-error agency-name (str "Unsupported hair event: " (:type event)))]))

(defn handle-command! [state command]
  (case (:type command)
    "configure" (configure! state (:config command))
    "registerObjects" (register-objects! state (:objects command))
    "send" (dispatch-event! state (:event command))
    "setHairColor" (set-hair-color! state (:color command))
    "setEyebrowColor" (set-eyebrow-color! state (:color command))
    "setHairBaseColor" (set-hair-base-color! state (:baseColor command))
    "setEyebrowBaseColor" (set-eyebrow-base-color! state (:baseColor command))
    "setHairGlow" (set-hair-glow! state (:emissive command) (:intensity command))
    "setEyebrowGlow" (set-eyebrow-glow! state (:emissive command) (:intensity command))
    "setOutline" (set-outline! state (:show command) (:color command) (:opacity command))
    "setPartVisibility" (set-part-visibility! state (:partName command) (:visible command))
    "setPartScale" (set-part-scale! state (:partName command) (:scale command))
    "setPartPosition" (set-part-position! state (:partName command) (:position command))
    "resetToDefault" (reset-to-default! state)
    "setPhysicsEnabled" (set-physics-enabled! state (:enabled command))
    "updatePhysicsConfig" (update-physics-config! state (:config command))
    (dispatch-event! state command)))
