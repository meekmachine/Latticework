(ns latticework.runtime
  (:require [latticework.blink :as blink]
            [latticework.protocol :as protocol]))

(defn- fn-prop [value key]
  (let [candidate (and value (aget value key))]
    (when (fn? candidate) candidate)))

(defn- emit-callback! [host output]
  (when-let [on-output (fn-prop host "onOutput")]
    (on-output (protocol/data->js output))))

(defn- emit-state! [host state]
  (when-let [on-state (fn-prop host "onState")]
    (on-state (protocol/data->js state))))

(defn- schedule-cleanup! [host scheduled-name snippet]
  (when (and scheduled-name (fn-prop host "removeSnippet"))
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
    (when-let [schedule-snippet (fn-prop host "scheduleSnippet")]
      (let [snippet (:snippet output)
            options (:options output)
            scheduled-name (schedule-snippet
                            (protocol/data->js snippet)
                            (protocol/data->js options))]
        (schedule-cleanup! host scheduled-name snippet)))

    "removeSnippet"
    (when-let [remove-snippet (fn-prop host "removeSnippet")]
      (remove-snippet (:name output)))

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
