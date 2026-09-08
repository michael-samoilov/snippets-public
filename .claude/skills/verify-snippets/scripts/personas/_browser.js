// In-browser iOS (Safari tab / Chrome iOS): standalone exists and is false.
Object.defineProperty(navigator, 'standalone', {get: () => false, configurable: true});
