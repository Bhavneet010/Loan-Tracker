import { toast } from "./utils.js";
import { createLazyAction } from "./lazy-action.js";

function registerLazyAction(name, modulePath, failureLabel, beforeLoad) {
  window[name] = createLazyAction({
    name,
    modulePath,
    loadModule: path => import(path),
    getAction: actionName => window[actionName],
    beforeLoad,
    onError: error => {
      console.error(`[LazyAction] ${name} failed`, error);
      toast(`Could not load ${failureLabel}`);
    },
  });
}

for (const name of [
  "overrideSnapshotLock",
  "runMonthEndSnapshot",
  "runMonthEndCleanup",
  "renderMonthEndSettings",
  "toggleMeHistCard",
  "toggleMeHistEdit",
  "deleteMonthSnapshot",
]) {
  registerLazyAction(name, "./month-end.js", "month-end tools");
}

for (const name of [
  "exportLoansExcel",
  "closeCalExportMenu",
  "exportCalendarRenewalsExcel",
  "exportCalendarRenewalsPdf",
]) {
  registerLazyAction(name, "./export-excel.js", "export tools");
}

registerLazyAction(
  "toggleCalExportMenu",
  "./export-excel.js",
  "export tools",
  event => event?.stopPropagation(),
);
