/// Must fail to compile: the fresh target exposes no holder-only decrypt path.
module no_holder_read::attack;

use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_output::output_v8::{Self, CompleteOutputV8, CompleteReceiptV8};

public fun old_holder_cannot_request_fields<PaymentCoin>(
    output: &CompleteOutputV8, receipt: &CompleteReceiptV8,
    root: &MakerRootV8<PaymentCoin>, ctx: &TxContext,
) {
    let _ = output_v8::complete_decrypt_fields_v8(output, receipt, root, ctx);
}
