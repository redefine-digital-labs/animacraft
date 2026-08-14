/// Must not compile: a consumed Complete proof cannot be replayed.
module animacraft_v8_seal_adversarial_replay::attack;

use animacraft_v8_seal::seal_v8::CompleteDecryptProofV8;

public fun replay(proof: CompleteDecryptProofV8): vector<CompleteDecryptProofV8> {
    let mut attempts = vector[];
    attempts.push_back(proof);
    attempts.push_back(proof);
    attempts
}
