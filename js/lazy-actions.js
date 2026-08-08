import { toast } from "./utils.js";

function registerLazyAction(name, modulePath, failureLabel) {
  const lazyAction = async (...args) => {
    try {
      await import(modulePath);
      const loadedAction = window[name];
      if (typeof loadedAction !== "function" || loadedAction === lazyAction) {
        throw new Error(`${modulePath} did not register window.${name}`);
      }
      return await loadedAction(...args);
    } catch (error) {
      console.error(`[LazyAction] ${name} failed`, error);
      toast(`Could not load ${failureLabel}`);
      return undefined;
    }
  };
  window[name] = lazyAction;
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
  "toggleCalExportMenu",
  "closeCalExportMenu",
  "exportCalendarRenewalsExcel",
  "exportCalendarRenewalsPdf",
]) {
  registerLazyAction(name, "./export-excel.js", "export tools");
}
