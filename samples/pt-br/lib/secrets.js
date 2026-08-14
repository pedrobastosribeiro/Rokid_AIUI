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
export const REMOTE_API_KEY = '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';

// Override the provider without editing code elsewhere. Leave the base URL empty
// to use the default in `remote-model.js`. Pointing these at a gateway you own
// is the intended end state: the device then carries a token you issue and can
// revoke per device, and the provider key stays server-side where changing the
// routing is a deploy instead of a device update.
export const REMOTE_BASE_URL = '';
export const REMOTE_MODEL = '';
