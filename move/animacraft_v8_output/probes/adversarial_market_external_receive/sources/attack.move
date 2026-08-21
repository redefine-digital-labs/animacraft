module output_adversarial_market_external_receive::attack;

use animacraft_v8_output::output_v8::{CanonicalSoulV8, CompleteOutputV8,
    CompleteReceiptV8};
use sui::transfer::{Self as transfer, Receiving};

// Must fail: only Output, the defining module, can receive key-without-store
// bundle objects from a Listing UID.
public fun receive_output(
    parent: &mut UID,
    receiving: Receiving<CompleteOutputV8>,
): CompleteOutputV8 {
    transfer::receive(parent, receiving)
}

public fun receive_receipt(
    parent: &mut UID,
    receiving: Receiving<CompleteReceiptV8>,
): CompleteReceiptV8 {
    transfer::receive(parent, receiving)
}

public fun receive_soul(
    parent: &mut UID,
    receiving: Receiving<CanonicalSoulV8>,
): CanonicalSoulV8 {
    transfer::receive(parent, receiving)
}
