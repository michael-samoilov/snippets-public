// Installed to the home screen: what isIOSStandalone() and any display-mode
// media query read. The matchMedia stub keeps the listener API shape so React
// effects that subscribe don't throw.
Object.defineProperty(navigator, 'standalone', {get: () => true, configurable: true});
const __mm = window.matchMedia.bind(window);
window.matchMedia = (q) => {
  if (/display-mode:\s*standalone/.test(q)) {
    return {matches: true, media: q, onchange: null,
            addEventListener() {}, removeEventListener() {},
            addListener() {}, removeListener() {},
            dispatchEvent: () => false};
  }
  return __mm(q);
};
