(ns latticework.npm
  (:require [latticework.runtime :as runtime]))

(defn create-animation-agency
  ([config] (runtime/create-in-process-animation-agency config nil))
  ([config host] (runtime/create-in-process-animation-agency config host)))

(defn create-blink-agency
  ([config] (runtime/create-in-process-blink-agency config nil))
  ([config host] (runtime/create-in-process-blink-agency config host)))

(defn create-gaze-agency
  ([config] (runtime/create-in-process-gaze-agency config nil))
  ([config host] (runtime/create-in-process-gaze-agency config host)))

(defn create-hair-agency
  ([config] (runtime/create-in-process-hair-agency config nil))
  ([config host] (runtime/create-in-process-hair-agency config host)))

(defn create-agency-worker-client [worker host]
  (runtime/create-worker-client worker host))

(defn create-animation-worker-client [worker host]
  (runtime/create-animation-worker-client worker host))

(defn create-blink-worker-client [worker host]
  (runtime/create-blink-worker-client worker host))

(defn create-gaze-worker-client [worker host]
  (runtime/create-gaze-worker-client worker host))

(defn create-hair-worker-client [worker host]
  (runtime/create-hair-worker-client worker host))

(defn install-latticework
  ([] (install-latticework js/globalThis))
  ([target]
   (let [api #js {:createBlinkAgency create-blink-agency
                  :createAnimationAgency create-animation-agency
                  :createGazeAgency create-gaze-agency
                  :createHairAgency create-hair-agency
                  :createAgencyWorkerClient create-agency-worker-client
                  :createAnimationWorkerClient create-animation-worker-client
                  :createBlinkWorkerClient create-blink-worker-client
                  :createGazeWorkerClient create-gaze-worker-client
                  :createHairWorkerClient create-hair-worker-client}]
     (aset target "Latticework" api)
     api)))
