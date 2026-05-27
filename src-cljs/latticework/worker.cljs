(ns latticework.worker
  (:require [latticework.animation :as animation]
            [latticework.blink :as blink]
            [latticework.gaze :as gaze]
            [latticework.hair :as hair]
            [latticework.protocol :as protocol]))

(defonce animation-state (animation/create-state))
(defonce blink-state (blink/create-state))
(defonce blink-auto-timer (atom nil))
(defonce gaze-state (gaze/create-state))
(defonce hair-state (hair/create-state))

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
    "animation" (animation/handle-command! animation-state command)
    "blink" (let [outputs (blink/handle-command! blink-state command)]
              (when (blink/auto-command? command)
                (sync-blink-auto!))
              outputs)
    "gaze" (gaze/handle-command! gaze-state command)
    "hair" (hair/handle-command! hair-state command)
    [(protocol/emit-error
      (or (:agency command) "unknown")
      (str "Unsupported agency: " (:agency command)))]))

(defn- handle-message! [event]
  (let [command (protocol/js->data (.-data event))]
    (post-outputs! (dispatch! command))))

(defn init []
  (.addEventListener js/self "message" handle-message!)
  (post-output! (protocol/emit-state animation/agency-name (animation/snapshot animation-state)))
  (post-output! (protocol/emit-state blink/agency-name (blink/snapshot blink-state)))
  (post-output! (protocol/emit-state gaze/agency-name (gaze/snapshot gaze-state)))
  (post-output! (protocol/emit-state hair/agency-name (hair/snapshot hair-state)))
  (sync-blink-auto!))
