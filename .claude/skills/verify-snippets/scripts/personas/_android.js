// Android identity: isIOS() reads platform + touch and must come back false.
Object.defineProperty(navigator, 'platform', {get: () => 'Linux armv8l', configurable: true});
Object.defineProperty(navigator, 'maxTouchPoints', {get: () => 5, configurable: true});
