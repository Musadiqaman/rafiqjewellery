# Thumb Images and Physical Scanners

The app has three distinct capabilities:

1. **Camera:** captures the centre crop of the actual camera frame. Auto capture waits for a stable frame with a basic brightness/contrast check. It does not detect fingers, assess fingerprint ridge quality, extract a biometric template or verify identity. The saved image is not artificially changed into a fingerprint. Align the finger in the guide and review the image before using it.
2. **Upload:** accepts an existing ink impression or scanner image as JPG, PNG or WebP, up to 3 MB. The server validates the decoded image, encrypts its original bytes and stores its SHA-256 hash with the record.
3. **External scanner:** calls a configured local bridge that must be implemented using the scanner vendor's SDK. The bridge is hardware-specific and is not included. Provide the exact model, SDK and target OS to implement and test it.

## Bridge contract

Configure a local HTTPS origin such as `https://localhost:8443` in Settings. The cashier enters a pairing token for that browser session; it is held in memory and is never stored with a purchase.

```http
POST /capture
Authorization: Bearer <pairing-token>
Origin: https://your-shop-domain
```

Success returns actual image bytes with `Content-Type: image/png`, `image/jpeg` or `image/webp`, no more than 3 MB. Non-success returns a non-2xx HTTP status. The browser cancels after 20 seconds.

The bridge must bind only to loopback, use a trusted TLS certificate, validate the exact allowed Origin and pairing token, implement CORS preflight, rate-limit captures and restrict the connected device. Do not disable browser security or use a public unauthenticated capture endpoint. On mobile, a localhost bridge would have to run on that mobile device; a desktop scanner bridge is not automatically reachable from an iPhone or Android browser.

## Verification

The UI labels the result **Captured**, not **Verified**. Identity matching requires an authorized identity/biometric service and a verified integration result. Such a provider has not been supplied. Device passkeys verify the staff login using the device's authenticator; they do not provide a seller's fingerprint image or match it to a CNIC.

Test the physical device, bridge authentication, image clarity, timeout/cancel, browser support and receipt output before using the scanner in the shop.
