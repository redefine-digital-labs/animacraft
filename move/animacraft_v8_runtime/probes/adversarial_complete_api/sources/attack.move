module runtime_adversarial_complete_api::attack;

use animacraft_v8_runtime::runtime_v8::{
    Self as runtime,
    MakerLoadoutV8,
    PackCompleteLineV8,
    PackPassV8,
    PackRegistryV8,
    PackReleaseV8,
    RuntimeLoadoutAuthorizationV8,
};

// Must fail: an external package cannot bypass the Core OutputRuntimeRequest
// adapter and reach the counter mutator directly.
public fun bypass_output_request<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    packs: &PackRegistryV8,
    pass: &PackPassV8,
    authorization: &RuntimeLoadoutAuthorizationV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
): PackCompleteLineV8 {
    runtime::authorize_pack_complete_line_v8(
        release, packs, pass, authorization, loadout, ctx,
    )
}
