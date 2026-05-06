const CRED_KEY = 'lpBiometricCredId';

export function isBiometricSupported() {
  return typeof window.PublicKeyCredential !== 'undefined'
    && typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';
}

export async function isBiometricAvailable() {
  if (!isBiometricSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

export function isBiometricRegistered() {
  return !!localStorage.getItem(CRED_KEY);
}

export async function registerBiometric() {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const opts = {
    challenge,
    rp: { name: 'Nirnay' },
    user: { id: userId, name: 'admin@nirnay', displayName: 'Admin' },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 }
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      requireResidentKey: false
    },
    timeout: 60000
  };

  // rpId cannot be an IP address or empty — omit for file:// or IP origins
  const host = window.location.hostname;
  if (host && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    opts.rp.id = host;
  }

  const credential = await navigator.credentials.create({ publicKey: opts });
  const credIdB64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
  localStorage.setItem(CRED_KEY, credIdB64);
  return true;
}

export async function authenticateBiometric() {
  const credIdB64 = localStorage.getItem(CRED_KEY);
  if (!credIdB64) throw new Error('No biometric registered');

  const credId = Uint8Array.from(atob(credIdB64), c => c.charCodeAt(0));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const opts = {
    challenge,
    allowCredentials: [{ type: 'public-key', id: credId, transports: ['internal'] }],
    userVerification: 'required',
    timeout: 60000
  };

  const host = window.location.hostname;
  if (host && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    opts.rpId = host;
  }

  const assertion = await navigator.credentials.get({ publicKey: opts });
  return !!assertion;
}

export function removeBiometric() {
  localStorage.removeItem(CRED_KEY);
}
