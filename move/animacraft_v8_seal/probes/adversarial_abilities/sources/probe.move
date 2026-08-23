/// Must not compile: every certification/proof/readiness value is ephemeral.
module animacraft_v8_seal_adversarial_abilities::probe;

use animacraft_v8_seal::seal_v8::{
    BaseDecryptProofV8,
    CiphertextCertificationV8,
    CompleteDecryptProofV8,
    PackDecryptProofV8,
    PrivateSealReadinessWitnessV8,
    SealReadinessV8,
};

public struct StoreCiphertext has store { value: CiphertextCertificationV8 }
public struct StoreBase has store { value: BaseDecryptProofV8 }
public struct StorePack has store { value: PackDecryptProofV8 }
public struct StoreComplete has store { value: CompleteDecryptProofV8 }
public struct StorePrivateReadiness has store { value: PrivateSealReadinessWitnessV8 }
public struct StoreReadiness has store { value: SealReadinessV8 }

public fun copy_ciphertext(value: &CiphertextCertificationV8): CiphertextCertificationV8 { *value }
public fun copy_base(value: &BaseDecryptProofV8): BaseDecryptProofV8 { *value }
public fun copy_pack(value: &PackDecryptProofV8): PackDecryptProofV8 { *value }
public fun copy_complete(value: &CompleteDecryptProofV8): CompleteDecryptProofV8 { *value }
public fun copy_readiness(value: &SealReadinessV8): SealReadinessV8 { *value }

public fun discard_ciphertext(value: CiphertextCertificationV8) { let _ = value; }
public fun discard_base(value: BaseDecryptProofV8) { let _ = value; }
public fun discard_pack(value: PackDecryptProofV8) { let _ = value; }
public fun discard_complete(value: CompleteDecryptProofV8) { let _ = value; }
public fun discard_private(value: PrivateSealReadinessWitnessV8) { let _ = value; }
public fun discard_readiness(value: SealReadinessV8) { let _ = value; }
