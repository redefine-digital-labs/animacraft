module physical_adversarial_receipt_proof::attack;

use animacraft_v8_physical::physical_v8 as physical;

// Must fail: receipt-only Physical proof authority was removed. Output always
// creates the Canonical Soul in the same PTB as the Complete artifacts.
public fun removed_receipt_only_proof(): u8 {
    physical::proof_complete_receipt_v8()
}
