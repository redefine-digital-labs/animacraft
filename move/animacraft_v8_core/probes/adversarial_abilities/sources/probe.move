/// External attacks on current linear setup, companion assembly and rights authority.
#[allow(unused_field)]
module animacraft_v8_core_adversarial_abilities::probe;

use animacraft_v8_core::maker_v8::{SuccessorAuthorityV8, WrappedRightsCertificationV8};
use animacraft_v8_core::companion_binding_v2::MakerRuntimeCompanionBindingBuilderV2;
use animacraft_v8_core::package_binding_v8::{
    PackageCallCapV8, SealRoleV8, RuntimeRoleV8, OutputRoleV8, PhysicalRoleV8,
    MarketRoleV8, ReleaseRoleV8, RuntimeCallerCapV1, FreshTupleBootstrapUseWitnessV2,
};

public struct StoreCompanionBuilder has store { value: MakerRuntimeCompanionBindingBuilderV2<sui::sui::SUI> }
public fun discard_CompanionBuilder(value: MakerRuntimeCompanionBindingBuilderV2<sui::sui::SUI>) { let _ = value; }
public fun copy_CompanionBuilder(value: &MakerRuntimeCompanionBindingBuilderV2<sui::sui::SUI>): MakerRuntimeCompanionBindingBuilderV2<sui::sui::SUI> { *value }

public struct StoreBootstrapWitness has store { value: FreshTupleBootstrapUseWitnessV2 }
public fun discard_BootstrapWitness(value: FreshTupleBootstrapUseWitnessV2) { let _ = value; }
public fun copy_BootstrapWitness(value: &FreshTupleBootstrapUseWitnessV2): FreshTupleBootstrapUseWitnessV2 { *value }

public struct StoreRightsCertification has store { value: WrappedRightsCertificationV8 }
public fun discard_RightsCertification(value: WrappedRightsCertificationV8) { let _ = value; }
public fun copy_RightsCertification(value: &WrappedRightsCertificationV8): WrappedRightsCertificationV8 { *value }

public struct StoreSuccessor has store { value: SuccessorAuthorityV8<sui::sui::SUI> }
public fun discard_Successor(value: SuccessorAuthorityV8<sui::sui::SUI>) { let _ = value; }
public fun copy_Successor(value: &SuccessorAuthorityV8<sui::sui::SUI>): SuccessorAuthorityV8<sui::sui::SUI> { *value }

public struct StoreSealSetupCap has store { value: PackageCallCapV8<SealRoleV8> }
public fun discard_SealSetupCap(value: PackageCallCapV8<SealRoleV8>) { let _ = value; }
public fun copy_SealSetupCap(value: &PackageCallCapV8<SealRoleV8>): PackageCallCapV8<SealRoleV8> { *value }

public struct StoreRuntimeSetupCap has store { value: PackageCallCapV8<RuntimeRoleV8> }
public fun discard_RuntimeSetupCap(value: PackageCallCapV8<RuntimeRoleV8>) { let _ = value; }
public fun copy_RuntimeSetupCap(value: &PackageCallCapV8<RuntimeRoleV8>): PackageCallCapV8<RuntimeRoleV8> { *value }

public struct StoreOutputSetupCap has store { value: PackageCallCapV8<OutputRoleV8> }
public fun discard_OutputSetupCap(value: PackageCallCapV8<OutputRoleV8>) { let _ = value; }
public fun copy_OutputSetupCap(value: &PackageCallCapV8<OutputRoleV8>): PackageCallCapV8<OutputRoleV8> { *value }

public struct StorePhysicalSetupCap has store { value: PackageCallCapV8<PhysicalRoleV8> }
public fun discard_PhysicalSetupCap(value: PackageCallCapV8<PhysicalRoleV8>) { let _ = value; }
public fun copy_PhysicalSetupCap(value: &PackageCallCapV8<PhysicalRoleV8>): PackageCallCapV8<PhysicalRoleV8> { *value }

public struct StoreMarketSetupCap has store { value: PackageCallCapV8<MarketRoleV8> }
public fun discard_MarketSetupCap(value: PackageCallCapV8<MarketRoleV8>) { let _ = value; }
public fun copy_MarketSetupCap(value: &PackageCallCapV8<MarketRoleV8>): PackageCallCapV8<MarketRoleV8> { *value }

public struct StoreReleaseSetupCap has store { value: PackageCallCapV8<ReleaseRoleV8> }
public fun discard_ReleaseSetupCap(value: PackageCallCapV8<ReleaseRoleV8>) { let _ = value; }
public fun copy_ReleaseSetupCap(value: &PackageCallCapV8<ReleaseRoleV8>): PackageCallCapV8<ReleaseRoleV8> { *value }

// Runtime caller caps must be stored by their package configs, but not cloned or dropped.
public fun discard_runtime_caller(value: RuntimeCallerCapV1) { let _ = value; }
public fun copy_runtime_caller(value: &RuntimeCallerCapV1): RuntimeCallerCapV1 { *value }
