export function createLazyAction({
  name,
  modulePath,
  loadModule,
  getAction,
  beforeLoad,
  onError,
}) {
  const lazyAction = async (...args) => {
    try {
      beforeLoad?.(...args);
      await loadModule(modulePath);
      const loadedAction = getAction(name);
      if (typeof loadedAction !== "function" || loadedAction === lazyAction) {
        throw new Error(`${modulePath} did not register window.${name}`);
      }
      return await loadedAction(...args);
    } catch (error) {
      onError?.(error);
      return undefined;
    }
  };
  return lazyAction;
}
