/// Compile-only shape check for future Runtime/Release consumers.
module animacraft_v8_seal_companion_probe::probe;

use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8;
use animacraft_v8_seal::seal_v8::{
    Self as seal,
    BaseDecryptProofV8,
    SealPolicyConfigV8,
    SealReadinessV8,
    SealRegistryV8,
};
use std::string::String;

public struct RuntimeOriginalMarkerV8 has drop {}
public struct RuntimeBaseEntitlementWitnessV8 {}

public fun certify_base<PaymentCoin>(
    catalog: &ProductReleaseCatalogV8,
    root: &MakerRootV8<PaymentCoin>,
    holder: address,
    entitlement_id: ID,
    entitlement_commitment: vector<u8>,
    scope_key: String,
    asset_key: String,
    seal_id: vector<u8>,
): BaseDecryptProofV8 {
    let witness = RuntimeBaseEntitlementWitnessV8 {};
    let (witness, proof) = seal::certify_base_entitlement_v8<
        PaymentCoin,
        RuntimeOriginalMarkerV8,
        RuntimeBaseEntitlementWitnessV8,
    >(witness, catalog, root, holder,
        entitlement_id, entitlement_commitment, scope_key, asset_key, seal_id);
    let RuntimeBaseEntitlementWitnessV8 {} = witness;
    proof
}

public fun consume_readiness<PaymentCoin, ReleaseAuthority: key>(
    readiness: SealReadinessV8,
    registry: &SealRegistryV8,
    policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    authority: &ReleaseAuthority,
): (ID, ID, vector<ID>, vector<u8>, vector<u8>, ID, u64, vector<u8>, vector<u8>, u64) {
    seal::consume_seal_readiness_v8(
        readiness, registry, policy, root, catalog, authority)
}
