// iPhone identity: what isIOS() reads. The UA rides the --user-agent flag.
Object.defineProperty(navigator, 'platform', {get: () => 'iPhone', configurable: true});
Object.defineProperty(navigator, 'maxTouchPoints', {get: () => 5, configurable: true});
