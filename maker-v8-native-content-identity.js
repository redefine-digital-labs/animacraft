import { bcs } from '@mysten/sui/bcs';
import { deriveObjectID, fromHex } from '@mysten/sui/utils';

const Key = bcs.struct('ContentMintKeyV1', { author: bcs.Address, nonce: bcs.vector(bcs.u8()) });
export function deriveMakerV8NativeContentIdV8(config, signer, mintNonce) {
  for (const value of [config?.kioskRegistryId, config?.soulidityOriginalPackageId, signer]) {
    if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) {
      throw new Error('MAKER_V8_NATIVE_CONTENT_IDENTITY_INVALID');
    }
  }
  if (typeof mintNonce !== 'string' || !/^[0-9a-f]{32}$/.test(mintNonce)) throw new Error('MAKER_V8_NATIVE_CONTENT_NONCE_INVALID');
  return deriveObjectID(config.kioskRegistryId, `${config.soulidityOriginalPackageId}::market::ContentMintKeyV1`,
    Key.serialize({ author: signer, nonce: fromHex(mintNonce) }).toBytes());
}
