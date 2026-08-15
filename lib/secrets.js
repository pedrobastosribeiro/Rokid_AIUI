// Paste a provider key here to test on device, and take it out before you
// commit. `npm test` fails the `samples` check while this is non-empty, so the
// mistake is caught by CI rather than by someone finding the key later.
//
// This is the *testing* path, not the design. A key that lives in this file
// travels inside the packed `.aix` to Studio, which means it is published, and
// rotating it means shipping a new build. The path meant to outlive the test is
// device storage -- `storeApiKey()` in `remote-model.js`, read first and
// preferred over this constant -- seeded by scanning a QR code with the camera,
// the way `samples/scanner` already reads one through `BarcodeDetector`. Then
// the key never enters the repository or the bundle at all.
export const REMOTE_API_KEY = '';

// Override the provider without editing code elsewhere. Leave the base URL empty
// to use the default in `remote-model.js`.
//
// The direct-to-provider path this defaults to is the deliberate choice here,
// not a stepping stone: one hop, nothing to operate. Its cost is that the
// provider key lives on the device and the prompt ships in the bundle, so
// rotating either means a new build. A server of your own in front would move
// both off the device, at the price of running one -- worth knowing as an option
// if that cost ever starts to bite, not something this sample is heading toward.
export const REMOTE_BASE_URL = '';
export const REMOTE_MODEL = '';
