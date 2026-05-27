(ns latticework.protocol)

(defn js->data [value]
  (js->clj value :keywordize-keys true))

(defn data->js [value]
  (clj->js value))

(defn now-ms []
  (if (and (exists? js/performance) (.-now js/performance))
    (.now js/performance)
    (.now js/Date)))

(defn clamp [low high value]
  (-> value
      (max low)
      (min high)))

(defn maybe-number [value fallback]
  (if (number? value) value fallback))

(defn emit-state [agency state]
  {:type "state"
   :agency agency
   :state state})

(defn emit-schedule-snippet
  ([agency snippet]
   (emit-schedule-snippet agency snippet nil))
  ([agency snippet options]
   (cond-> {:type "scheduleSnippet"
            :agency agency
            :snippet snippet}
     options (assoc :options options))))

(defn emit-remove-snippet [agency name]
  {:type "removeSnippet"
   :agency agency
   :name name})

(defn emit-animation-effect [agency effect]
  {:type "animationEffect"
   :agency agency
   :effect effect})

(defn emit-error [agency message]
  {:type "error"
   :agency agency
   :message message})
