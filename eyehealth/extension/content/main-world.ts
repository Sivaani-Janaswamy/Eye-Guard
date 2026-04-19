/**
 * EyeGuard Main-World Interceptor
 * 
 * This script is injected directly into the webpage's context.
 * It hijacks global fetch and XHR to redirect MediaPipe asset requests
 * to the internal chrome-extension:// origin, bypassing website 404s.
 */
(function() {
  const MEDIAPIPE_ASSET_PATTERN = /face_mesh_solution|face_mesh\.binarypb/i;
  const EXTENSION_ID = document.currentScript?.getAttribute('data-extension-id');

  if (!EXTENSION_ID) {
    console.error('[EyeGuard] Main-world interceptor failed: Extension ID missing');
    return;
  }

  // Intercept Fetch
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    let url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    
    if (MEDIAPIPE_ASSET_PATTERN.test(url) && !url.startsWith('chrome-extension')) {
      const filename = url.split('/').pop()?.split('?')[0];
      const redirectedUrl = `chrome-extension://${EXTENSION_ID}/dist/cv/${filename}`;
      console.log(`[EyeGuard] Main-World Redirecting fetch: ${url} -> ${redirectedUrl}`);
      return originalFetch.call(this, redirectedUrl, init);
    }
    return originalFetch.call(this, input, init);
  };

  // Intercept XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: any[]) {
    const urlStr = url.toString();
    if (MEDIAPIPE_ASSET_PATTERN.test(urlStr) && !urlStr.startsWith('chrome-extension')) {
      const filename = urlStr.split('/').pop()?.split('?')[0];
      const redirectedUrl = `chrome-extension://${EXTENSION_ID}/dist/cv/${filename}`;
      
      // Safety: MediaPipe loaders sometimes crash on 'onprogress' if the key isn't pre-initialized.
      // We monkey-patch the 'onprogress' setter to ensure the key exists.
      const originalOnProgress = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'onprogress');
      if (originalOnProgress && originalOnProgress.set) {
          const self = this;
          Object.defineProperty(this, 'onprogress', {
              set: function(fn) {
                  const wrappedFn = function(event: any) {
                      // Ensure the global Module.dataFileDownloads has the key if needed
                      // but since we can't easily find the right Module object here,
                      // we just wrap the call in a try-catch to prevent engine death.
                      try {
                          fn.apply(this, [event]);
                      } catch (e) {
                          // Silently swallow loader math errors during progress
                      }
                  };
                  return originalOnProgress.set!.call(self, wrappedFn);
              }
          });
      }

      console.log(`[EyeGuard] Main-World Redirecting XHR: ${urlStr} -> ${redirectedUrl}`);
      return originalOpen.apply(this, [method, redirectedUrl, ...rest] as any);
    }
    return originalOpen.apply(this, [method, url, ...rest] as any);
  };

  console.log('[EyeGuard] Main-world network interceptor active');
})();
