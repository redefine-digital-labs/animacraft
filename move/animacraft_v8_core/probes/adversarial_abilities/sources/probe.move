/// This package must not compile. It proves Core proofs, wrapped-rights
/// certification, and companion witnesses cannot be copied, discarded, or
/// stored by external code.
module animacraft_v8_core_adversarial_abilities::probe;

use animacraft_v8_core::activation_v8::{
    MarketReadinessV8,
    OutputReadinessV8,
    OutputRuntimeRequestV8,
    PhysicalReadinessV8,
    RuntimeActivationReadinessV8,
    SealReadinessV8,
};

use animacraft_v8_core::maker_v8::{
    SuccessorAuthorityV8,
    WrappedRightsCertificationV8,
};
use animacraft_v8_core::package_binding_v8::{
    PackageCallCapV8,
    ReleaseRoleV8,
    ReleaseCatalogWitnessV8,
    RuntimePackReadinessV8,
};
use animacraft_v8_core_companion_probe::probe::{
    ReleaseReadinessWitnessV8,
    RuntimePackReadinessWitnessV8 as CompanionRuntimeWitnessV8,
};

public struct StoreCoreRelease has store { value: ReleaseCatalogWitnessV8 }
public struct StoreCoreRuntime has store { value: RuntimePackReadinessV8 }
public struct StoreSealReadiness has store { value: SealReadinessV8 }
public struct StoreRuntimeReadiness has store { value: RuntimeActivationReadinessV8 }
public struct StoreOutputReadiness has store { value: OutputReadinessV8 }
public struct StorePhysicalReadiness has store { value: PhysicalReadinessV8 }
public struct StoreMarketReadiness has store { value: MarketReadinessV8 }
public struct StoreOutputRequest has store { value: OutputRuntimeRequestV8 }
public struct StoreRightsCertification has store { value: WrappedRightsCertificationV8 }
public struct StoreSuccessorAuthority has store { value: SuccessorAuthorityV8<sui::sui::SUI> }
public struct StoreCompanionRelease has store { value: ReleaseReadinessWitnessV8 }
public struct StoreCompanionRuntime has store { value: CompanionRuntimeWitnessV8 }

public fun discard_core_release(value: ReleaseCatalogWitnessV8) { let _ = value; }
public fun discard_core_runtime(value: RuntimePackReadinessV8) { let _ = value; }
public fun discard_seal_readiness(value: SealReadinessV8) { let _ = value; }
public fun discard_runtime_readiness(value: RuntimeActivationReadinessV8) { let _ = value; }
public fun discard_output_readiness(value: OutputReadinessV8) { let _ = value; }
public fun discard_physical_readiness(value: PhysicalReadinessV8) { let _ = value; }
public fun discard_market_readiness(value: MarketReadinessV8) { let _ = value; }
public fun discard_output_request(value: OutputRuntimeRequestV8) { let _ = value; }
public fun discard_rights(value: WrappedRightsCertificationV8) { let _ = value; }
public fun discard_successor(value: SuccessorAuthorityV8<sui::sui::SUI>) { let _ = value; }
public fun discard_companion_release(value: ReleaseReadinessWitnessV8) { let _ = value; }
public fun discard_companion_runtime(value: CompanionRuntimeWitnessV8) { let _ = value; }
public fun discard_call_cap(value: PackageCallCapV8<ReleaseRoleV8>) { let _ = value; }

public fun copy_core_release(value: &ReleaseCatalogWitnessV8): ReleaseCatalogWitnessV8 { *value }
public fun copy_core_runtime(value: &RuntimePackReadinessV8): RuntimePackReadinessV8 { *value }
public fun copy_seal_readiness(value: &SealReadinessV8): SealReadinessV8 { *value }
public fun copy_runtime_readiness(value: &RuntimeActivationReadinessV8): RuntimeActivationReadinessV8 { *value }
public fun copy_output_readiness(value: &OutputReadinessV8): OutputReadinessV8 { *value }
public fun copy_physical_readiness(value: &PhysicalReadinessV8): PhysicalReadinessV8 { *value }
public fun copy_market_readiness(value: &MarketReadinessV8): MarketReadinessV8 { *value }
public fun copy_output_request(value: &OutputRuntimeRequestV8): OutputRuntimeRequestV8 { *value }
public fun copy_rights(value: &WrappedRightsCertificationV8): WrappedRightsCertificationV8 { *value }
public fun copy_successor(
    value: &SuccessorAuthorityV8<sui::sui::SUI>,
): SuccessorAuthorityV8<sui::sui::SUI> { *value }
public fun copy_companion_release(value: &ReleaseReadinessWitnessV8): ReleaseReadinessWitnessV8 { *value }
public fun copy_companion_runtime(value: &CompanionRuntimeWitnessV8): CompanionRuntimeWitnessV8 { *value }
public fun copy_call_cap(
    value: &PackageCallCapV8<ReleaseRoleV8>,
): PackageCallCapV8<ReleaseRoleV8> { *value }
