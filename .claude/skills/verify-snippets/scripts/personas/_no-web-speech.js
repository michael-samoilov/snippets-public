// Chrome on iOS ships no Web Speech API; headless Chromium exposes both
// globals, so the persona must remove them or the app's engine probe lies.
Object.defineProperty(window, 'SpeechRecognition', {get: () => undefined, configurable: true});
Object.defineProperty(window, 'webkitSpeechRecognition', {get: () => undefined, configurable: true});
