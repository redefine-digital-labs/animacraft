import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import {
  isValidPersonalMessageSignature,
  isValidTransactionSignature,
} from '@mysten/sui/verify';
import {
  SUI_MAINNET_CHAIN,
  SuiSignPersonalMessage,
  SuiSignTransaction,
  SuiSignTransactionBlock,
  WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED,
  isWalletStandardError,
} from '@mysten/wallet-standard';

export const MAKER_V8_DAPP_KIT_WALLET_SCHEMA = 'animacraft.maker-v8-dapp-kit-wallet.v8';
export const MAKER_V8_DAPP_KIT_NETWORK = 'mainnet';

const EXACT_ADDRESS = /^0x[0-9a-f]{64}$/;
const PINNED_SLUSH_WEB_WALLET_ID = 'com.mystenlabs.suiwallet.web';
const PINNED_SLUSH_WALLET_NAME = 'Slush';
const PINNED_SLUSH_REJECTION_MESSAGE = 'User rejected the request';

export class MakerV8DAppKitWalletError extends Error {
  constructor(code, message, layer = 'WALLET', details = {}) {
    super(message);
    this.name = 'MakerV8DAppKitWalletError';
    this.code = code;
    this.layer = layer;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, layer = 'WALLET', details = {}) {
  throw new MakerV8DAppKitWalletError(code, message, layer, details);
}

function address(value, label) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (!EXACT_ADDRESS.test(normalized) || /^0x0+$/.test(normalized)) {
    fail(
      'MAKER_V8_DAPP_KIT_ACCOUNT_INVALID',
      `${label} must be an exact non-zero Sui address.`,
      'CONTEXT',
    );
  }
  return normalized;
}

function canonicalTransactionBytes(value, returned = false) {
  let raw;
  try {
    if (typeof value !== 'string' || value.length < 8) throw new TypeError('base64');
    raw = fromBase64(value);
    if (toBase64(raw) !== value) throw new TypeError('canonical base64');
    TransactionDataBuilder.fromBytes(raw);
  } catch {
    fail(
      returned
        ? 'MAKER_V8_DAPP_KIT_SIGNED_BYTES_DRIFT'
        : 'MAKER_V8_DAPP_KIT_TRANSACTION_BYTES_INVALID',
      returned
        ? 'The selected wallet returned invalid or non-canonical TransactionData bytes.'
        : 'TransactionData bytes must be canonical base64.',
      returned ? 'SIGNING' : 'VALIDATION',
    );
  }
  return raw;
}

function canonicalPersonalMessage(value, returned = false) {
  let raw;
  try {
    if (returned) {
      if (typeof value !== 'string' || value.length < 1) throw new TypeError('base64');
      raw = fromBase64(value);
      if (toBase64(raw) !== value) throw new TypeError('canonical base64');
    } else {
      if (!(value instanceof Uint8Array)) throw new TypeError('Uint8Array');
      raw = Uint8Array.from(value);
    }
    if (raw.length < 1 || raw.length > 16 * 1024) throw new RangeError('message bound');
  } catch {
    fail(
      'MAKER_V8_DAPP_KIT_PERSONAL_MESSAGE_INVALID',
      returned
        ? 'The selected wallet returned invalid or non-canonical personal-message bytes.'
        : 'Seal personal message must be a non-empty Uint8Array no larger than 16 KiB.',
      returned ? 'SIGNING' : 'VALIDATION',
    );
  }
  return raw;
}

function supportsMainnet(account) {
  return Array.isArray(account?.chains) && account.chains.includes(SUI_MAINNET_CHAIN);
}

function supportsSigning(wallet, account) {
  const walletFeatures = Array.isArray(wallet?.features) ? wallet.features : [];
  const accountFeatures = Array.isArray(account?.features) ? account.features : [];
  const hasModern = accountFeatures.includes(SuiSignTransaction)
    && walletFeatures.includes(SuiSignTransaction);
  const hasLegacy = accountFeatures.includes(SuiSignTransactionBlock)
    && walletFeatures.includes(SuiSignTransactionBlock);
  return hasModern || hasLegacy;
}

function supportsPersonalMessage(wallet, account) {
  const walletFeatures = Array.isArray(wallet?.features) ? wallet.features : [];
  const accountFeatures = Array.isArray(account?.features) ? account.features : [];
  return walletFeatures.includes(SuiSignPersonalMessage)
    && accountFeatures.includes(SuiSignPersonalMessage);
}

function isDefinitiveRejection(cause, wallet) {
  try {
    if (isWalletStandardError(cause, WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED)) {
      return true;
    }
  } catch {
    // Continue to the pinned Slush Web compatibility case below.
  }
  // Slush Web 1.1.4 receives an origin-checked `reject` response through its
  // pinned channel helper and turns only that response into this exact plain
  // Error. Keep the compatibility case pinned to the bundled web-wallet id;
  // do not classify arbitrary wallet errors or message lookalikes as safe
  // rejections because they may have returned an unknown signed artifact.
  return wallet?.id === PINNED_SLUSH_WEB_WALLET_ID
    && wallet?.name === PINNED_SLUSH_WALLET_NAME
    && cause?.constructor === Error
    && cause.name === 'Error'
    && cause.message === PINNED_SLUSH_REJECTION_MESSAGE
    && cause.code === undefined
    && cause.cause === undefined;
}

/**
 * Fresh-v8 signing adapter for the already-approved dAppKit connection.
 *
 * dAppKit remains the sole owner of wallet discovery, selection, connection,
 * restoration, and disconnection. This adapter only observes `$connection` and
 * asks its exact selected wallet/account to sign already-canonical bytes.
 */
export function createMakerV8DAppKitWalletAdapterV8({
  dAppKit,
  client,
  allowWalletSignature = true,
} = {}) {
  const connectionStore = dAppKit?.stores?.$connection;
  if (typeof connectionStore?.get !== 'function'
    || typeof connectionStore?.subscribe !== 'function') {
    fail(
      'MAKER_V8_DAPP_KIT_CONNECTION_STORE_INVALID',
      'The initialized dAppKit $connection store is required.',
      'CONFIGURATION',
    );
  }
  if (typeof dAppKit?.signTransaction !== 'function'
    || typeof dAppKit?.signPersonalMessage !== 'function') {
    fail(
      'MAKER_V8_DAPP_KIT_SIGN_FUNCTION_INVALID',
      'The initialized dAppKit signing actions are required.',
      'CONFIGURATION',
    );
  }

  let revision = 0;
  let disposed = false;
  let connection = connectionStore.get();
  const listeners = new Set();

  const project = (value, required = false) => {
    const wallet = value?.wallet ?? null;
    const account = value?.account ?? null;
    if (!wallet || !account?.address) {
      if (required) {
        fail(
          'MAKER_V8_DAPP_KIT_WALLET_NOT_CONNECTED',
          'Connect and select a Sui Mainnet account with the existing wallet control first.',
        );
      }
      return null;
    }
    if (!supportsMainnet(account) || !supportsSigning(wallet, account)) {
      if (required) {
        fail(
          'MAKER_V8_DAPP_KIT_WALLET_NETWORK_DRIFT',
          'The dAppKit-selected account no longer authorizes Sui Mainnet transaction signing.',
          'CONTEXT',
        );
      }
      return null;
    }
    return Object.freeze({
      wallet,
      account,
      address: address(account.address, 'dAppKit connection account'),
    });
  };

  const snapshot = () => {
    const selected = project(connection, false);
    return Object.freeze({
      schema: MAKER_V8_DAPP_KIT_WALLET_SCHEMA,
      revision,
      account: selected
        ? Object.freeze({ address: selected.address, network: MAKER_V8_DAPP_KIT_NETWORK })
        : null,
    });
  };

  const notify = () => {
    const value = snapshot();
    for (const listener of listeners) listener(value);
  };

  const unsubscribeConnection = connectionStore.subscribe((next) => {
    connection = next ?? connectionStore.get();
    revision += 1;
    notify();
  });

  const currentRequired = () => {
    if (disposed) {
      fail(
        'MAKER_V8_DAPP_KIT_ADAPTER_DISPOSED',
        'The dAppKit Fresh-v8 wallet adapter has been disposed.',
        'CONFIGURATION',
      );
    }
    connection = connectionStore.get();
    return project(connection, true);
  };

  const adapter = {
    async getCurrentAccount() {
      const selected = currentRequired();
      return Object.freeze({
        address: selected.address,
        network: MAKER_V8_DAPP_KIT_NETWORK,
      });
    },

    async reconnect() {
      // dAppKit owns autoConnect/restoration. Reading the restored connection is
      // intentionally the only operation here; no wallet is selected or opened.
      return adapter.getCurrentAccount();
    },

    async signExactTransaction({ bytes, digest: expectedDigest, signer } = {}) {
      if (allowWalletSignature !== true) {
        fail(
          'WEB_V8_SIGNING_DISABLED',
          'Wallet signing is disabled by the pinned deployment gate.',
          'SIGNING',
        );
      }
      const raw = canonicalTransactionBytes(bytes);
      const actualDigest = TransactionDataBuilder.getDigestFromBytes(raw);
      if (typeof expectedDigest !== 'string' || actualDigest !== expectedDigest) {
        fail(
          'MAKER_V8_DAPP_KIT_DIGEST_DRIFT',
          'Prepared digest does not match the exact canonical TransactionData bytes.',
          'CONTEXT',
        );
      }

      const selected = currentRequired();
      const expectedSigner = address(signer, 'prepared signer');
      if (selected.address !== expectedSigner) {
        fail(
          'MAKER_V8_DAPP_KIT_ACCOUNT_DRIFT',
          'The dAppKit-selected account differs from the prepared signer.',
          'CONTEXT',
        );
      }
      const captured = Object.freeze({
        wallet: selected.wallet,
        account: selected.account,
        address: selected.address,
        revision,
      });

      let result;
      try {
        result = await dAppKit.signTransaction({
          transaction: Transaction.from(raw),
          account: captured.account,
          network: MAKER_V8_DAPP_KIT_NETWORK,
        });
      } catch (cause) {
        if (!isDefinitiveRejection(cause, captured.wallet)) throw cause;
        const rejection = new MakerV8DAppKitWalletError(
          'MAKER_V8_DAPP_KIT_WALLET_REQUEST_REJECTED',
          'Wallet Standard reported an exact user-request rejection before returning a signed artifact.',
          'SIGNING',
        );
        rejection.definitiveRejection = true;
        rejection.signedArtifactCreated = false;
        throw rejection;
      }

      connection = connectionStore.get();
      const current = project(connection, false);
      if (!current
        || revision !== captured.revision
        || current.wallet !== captured.wallet
        || current.account !== captured.account
        || current.address !== captured.address) {
        fail(
          'MAKER_V8_DAPP_KIT_ACCOUNT_DRIFT',
          'The dAppKit connection changed while the exact signature prompt was open.',
          'CONTEXT',
        );
      }

      const returned = canonicalTransactionBytes(result?.bytes, true);
      if (toBase64(returned) !== toBase64(raw)) {
        fail(
          'MAKER_V8_DAPP_KIT_SIGNED_BYTES_DRIFT',
          'The selected wallet returned different TransactionData bytes.',
          'SIGNING',
        );
      }
      if (result?.digest !== undefined && result.digest !== actualDigest) {
        fail(
          'MAKER_V8_DAPP_KIT_DIGEST_DRIFT',
          'The selected wallet returned a digest that does not bind the exact TransactionData bytes.',
          'SIGNING',
        );
      }
      if (result?.signer !== undefined
        && address(result.signer, 'wallet result signer') !== captured.address) {
        fail(
          'MAKER_V8_DAPP_KIT_ACCOUNT_DRIFT',
          'The selected wallet returned a different signer.',
          'SIGNING',
        );
      }

      const signature = result?.signature;
      let verified = false;
      try {
        verified = typeof signature === 'string' && signature.length > 0
          && await isValidTransactionSignature(raw, signature, {
            client,
            address: captured.address,
          });
      } catch {
        verified = false;
      }
      if (!verified) {
        fail(
          'MAKER_V8_DAPP_KIT_SIGNATURE_INVALID',
          'The wallet signature does not authenticate the exact bytes and selected signer.',
          'SIGNING',
        );
      }

      return Object.freeze({
        bytes: toBase64(raw),
        digest: actualDigest,
        signature,
        signer: captured.address,
      });
    },

    async signExactPersonalMessage({ message, signer } = {}) {
      if (allowWalletSignature !== true) {
        fail(
          'WEB_V8_SIGNING_DISABLED',
          'Wallet signing is disabled by the pinned deployment gate.',
          'SIGNING',
        );
      }
      const raw = canonicalPersonalMessage(message);
      const selected = currentRequired();
      const expectedSigner = address(signer, 'protected-content signer');
      if (selected.address !== expectedSigner) {
        fail(
          'MAKER_V8_DAPP_KIT_ACCOUNT_DRIFT',
          'The dAppKit-selected account differs from the protected-content signer.',
          'CONTEXT',
        );
      }
      if (!supportsPersonalMessage(selected.wallet, selected.account)) {
        fail(
          'MAKER_V8_DAPP_KIT_PERSONAL_MESSAGE_UNAVAILABLE',
          'The dAppKit-selected account does not support Sui personal-message signing required by Seal.',
          'WALLET',
        );
      }
      const captured = Object.freeze({
        wallet: selected.wallet,
        account: selected.account,
        address: selected.address,
        revision,
      });

      let result;
      try {
        result = await dAppKit.signPersonalMessage({
          message: raw,
          account: captured.account,
          network: MAKER_V8_DAPP_KIT_NETWORK,
        });
      } catch (cause) {
        if (!isDefinitiveRejection(cause, captured.wallet)) throw cause;
        const rejection = new MakerV8DAppKitWalletError(
          'MAKER_V8_DAPP_KIT_WALLET_REQUEST_REJECTED',
          'Wallet Standard reported an exact user-request rejection before returning a signed artifact.',
          'SIGNING',
        );
        rejection.definitiveRejection = true;
        rejection.signedArtifactCreated = false;
        throw rejection;
      }

      connection = connectionStore.get();
      const current = project(connection, false);
      if (!current
        || revision !== captured.revision
        || current.wallet !== captured.wallet
        || current.account !== captured.account
        || current.address !== captured.address) {
        fail(
          'MAKER_V8_DAPP_KIT_ACCOUNT_DRIFT',
          'The dAppKit connection changed while the personal-message prompt was open.',
          'CONTEXT',
        );
      }

      const returned = canonicalPersonalMessage(result?.bytes, true);
      const exactBytes = returned.length === raw.length
        && returned.every((byte, index) => byte === raw[index]);
      const signature = result?.signature;
      let verified = false;
      try {
        verified = exactBytes
          && typeof signature === 'string'
          && signature.length > 0
          && await isValidPersonalMessageSignature(raw, signature, {
            client,
            address: captured.address,
          });
      } catch {
        verified = false;
      }
      if (!verified) {
        fail(
          'MAKER_V8_DAPP_KIT_PERSONAL_MESSAGE_INVALID',
          'The wallet did not authenticate the exact personal message and selected signer.',
          'SIGNING',
        );
      }

      return Object.freeze({
        bytes: toBase64(raw),
        signature,
        signer: captured.address,
      });
    },

    async verifyExactSignature({ bytes, digest: expectedDigest, signature, signer } = {}) {
      const raw = canonicalTransactionBytes(bytes);
      const expectedSigner = address(signer, 'signature signer');
      const actualDigest = TransactionDataBuilder.getDigestFromBytes(raw);
      if (actualDigest !== expectedDigest || typeof signature !== 'string' || !signature.length) {
        return false;
      }
      let verified = false;
      try {
        verified = await isValidTransactionSignature(raw, signature, {
          client,
          address: expectedSigner,
        });
      } catch {
        verified = false;
      }
      return verified ? Object.freeze({
        verified: true,
        bytes: toBase64(raw),
        digest: actualDigest,
        signer: expectedSigner,
      }) : false;
    },

    subscribe(listener) {
      if (typeof listener !== 'function') {
        fail(
          'MAKER_V8_DAPP_KIT_LISTENER_INVALID',
          'Wallet connection listener must be a function.',
          'CONFIGURATION',
        );
      }
      if (disposed) {
        fail(
          'MAKER_V8_DAPP_KIT_ADAPTER_DISPOSED',
          'The dAppKit Fresh-v8 wallet adapter has been disposed.',
          'CONFIGURATION',
        );
      }
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },

    async disconnect() {
      if (typeof dAppKit.disconnectWallet !== 'function') {
        fail(
          'MAKER_V8_DAPP_KIT_DISCONNECT_UNAVAILABLE',
          'The initialized dAppKit instance does not expose disconnectWallet.',
          'CONFIGURATION',
        );
      }
      return dAppKit.disconnectWallet();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof unsubscribeConnection === 'function') unsubscribeConnection();
      listeners.clear();
    },
  };

  return Object.freeze(adapter);
}
