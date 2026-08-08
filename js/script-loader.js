export function createRetryableScriptLoader({ documentRef, isReady, src, errorMessage }) {
  if (!documentRef?.head || typeof documentRef.createElement !== "function") {
    throw new TypeError("A document with a head element is required");
  }
  if (typeof isReady !== "function" || !src) {
    throw new TypeError("A readiness check and script source are required");
  }

  let loadPromise = null;

  return function ensureScript() {
    if (isReady()) return Promise.resolve();
    if (loadPromise) return loadPromise;

    const attempt = new Promise((resolve, reject) => {
      const script = documentRef.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => {
        if (isReady()) resolve();
        else reject(new Error(errorMessage || "Script did not initialize"));
      };
      script.onerror = () => reject(new Error(errorMessage || "Script failed to load"));
      documentRef.head.appendChild(script);
    });

    loadPromise = attempt.then(
      () => { loadPromise = null; },
      error => {
        loadPromise = null;
        throw error;
      },
    );
    return loadPromise;
  };
}
