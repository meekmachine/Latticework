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

(defn create-eye-head-tracking-agency
  ([config] (runtime/create-in-process-eye-head-tracking-agency config nil))
  ([config host] (runtime/create-in-process-eye-head-tracking-agency config host)))

(defn create-hair-agency
  ([config] (runtime/create-in-process-hair-agency config nil))
  ([config host] (runtime/create-in-process-hair-agency config host)))

(defn create-prosodic-agency
  ([config] (runtime/create-in-process-prosodic-agency config nil))
  ([config host] (runtime/create-in-process-prosodic-agency config host)))

(defn create-vocal-agency
  ([config] (runtime/create-in-process-vocal-agency config nil))
  ([config host] (runtime/create-in-process-vocal-agency config host)))

(defn create-lipsync-agency
  ([config] (runtime/create-in-process-lipsync-agency config nil))
  ([config host] (runtime/create-in-process-lipsync-agency config host)))

(defn create-agency-worker-client [worker host]
  (runtime/create-worker-client worker host))

(defn create-animation-worker-client [worker host]
  (runtime/create-animation-worker-client worker host))

(defn create-blink-worker-client [worker host]
  (runtime/create-blink-worker-client worker host))

(defn create-gaze-worker-client [worker host]
  (runtime/create-gaze-worker-client worker host))

(defn create-eye-head-tracking-worker-client [worker host]
  (runtime/create-eye-head-tracking-worker-client worker host))

(defn create-hair-worker-client [worker host]
  (runtime/create-hair-worker-client worker host))

(defn create-prosodic-worker-client [worker host]
  (runtime/create-prosodic-worker-client worker host))

(defn create-vocal-worker-client [worker host]
  (runtime/create-vocal-worker-client worker host))

(defn create-lipsync-worker-client [worker host]
  (runtime/create-lipsync-worker-client worker host))

(defn install-latticework
  ([] (install-latticework js/globalThis))
  ([target]
   (let [api #js {:createBlinkAgency create-blink-agency
                  :createAnimationAgency create-animation-agency
                  :createGazeAgency create-gaze-agency
                  :createEyeHeadTrackingAgency create-eye-head-tracking-agency
                  :createHairAgency create-hair-agency
                  :createLipSyncAgency create-lipsync-agency
                  :createProsodicAgency create-prosodic-agency
                  :createVocalAgency create-vocal-agency
                  :createAgencyWorkerClient create-agency-worker-client
                  :createAnimationWorkerClient create-animation-worker-client
                  :createBlinkWorkerClient create-blink-worker-client
                  :createGazeWorkerClient create-gaze-worker-client
                  :createEyeHeadTrackingWorkerClient create-eye-head-tracking-worker-client
                  :createHairWorkerClient create-hair-worker-client
                  :createLipSyncWorkerClient create-lipsync-worker-client
                  :createProsodicWorkerClient create-prosodic-worker-client
                  :createVocalWorkerClient create-vocal-worker-client}]
     (aset target "Latticework" api)
     api)))
