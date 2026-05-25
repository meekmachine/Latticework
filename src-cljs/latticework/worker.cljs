(ns latticework.worker
  (:require [latticework.blink :as blink]
            [latticework.protocol :as protocol]))

(defonce blink-state (blink/create-state))
(defonce blink-auto-timer (atom nil))

(defn- post-output! [output]
  (.postMessage js/self (protocol/data->js output)))

(defn- post-outputs! [outputs]
  (doseq [output outputs]
    (post-output! output)))

(defn- clear-blink-auto! []
  (when-let [timer @blink-auto-timer]
    (js/clearTimeout timer)
    (reset! blink-auto-timer nil)))

(declare schedule-next-blink!)

(defn- sync-blink-auto! []
  (if (:enabled @blink-state)
    (schedule-next-blink!)
    (clear-blink-auto!)))

(defn- schedule-next-blink! []
  (clear-blink-auto!)
  (when (:enabled @blink-state)
    (when-let [interval (blink/auto-interval-ms (blink/snapshot blink-state))]
      (reset! blink-auto-timer
              (js/setTimeout
               (fn []
                 (reset! blink-auto-timer nil)
                 (when (:enabled @blink-state)
                   (post-outputs! (blink/trigger-blink! blink-state nil))
                   (schedule-next-blink!)))
               interval)))))

(defn- dispatch! [command]
  (case (:agency command)
    "blink" (let [outputs (blink/handle-command! blink-state command)]
              (when (blink/auto-command? command)
                (sync-blink-auto!))
              outputs)
    [(protocol/emit-error
      (or (:agency command) "unknown")
      (str "Unsupported agency: " (:agency command)))]))

(defn- handle-message! [event]
  (let [command (protocol/js->data (.-data event))]
    (post-outputs! (dispatch! command))))

(defn init []
  (.addEventListener js/self "message" handle-message!)
  (post-output! (protocol/emit-state blink/agency-name (blink/snapshot blink-state)))
  (sync-blink-auto!))
