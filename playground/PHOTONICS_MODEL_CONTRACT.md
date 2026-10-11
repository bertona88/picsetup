# Photonics model contract — playground only

Use SI internally: m, W, radians, dB/m; UI converts nm, µm, mW and dB/cm once. Complex amplitudes have units sqrt(W), power |a|². Time convention Re{E exp(+iωt)}. S[output][input]. Each port is a single scalar TE0-declared mode at the modeled component boundary, without calibrated spatial fields.

b = S a + s; a = C b; solve (I − S C)b = s with pivoted complex elimination, never matrix inversion. C contains reciprocal propagation exactly once: h = 10^(−αL/20) exp(−i 2π n_eff L/λ). Constant n_eff is explicitly nondispersive. No pixel-derived physics.

Coupler ports [L0,L1,R0,R1], t=sqrt(1−K), q=i sqrt(K): S=[[0,0,t,q],[0,0,q,t],[t,q,0,0],[q,t,0,0]]. Phase shifter reciprocal transmission exp(−iφ); attenuator 10^(−A_dB/20). Source S=0 and injection sqrt(P)exp(iφ), absorbs returning power. Detector/termination S=0 reads/absorbs incoming power. Unconnected ports have a=0 (matched boundaries, not real open facets). One connection per port; crossing curves do not connect.

Report residual, scale-aware pivot diagnostics and a budget distinguishing source emission, escape at unconnected ports, detector absorption, termination/component absorption, returned source absorption, and propagation loss. Internal circulation is not output. Invalid/singular networks return diagnostics, never artificial damping. Target 1e−9 unit-scale analytical agreement and normalized residual <1e−10 for well-conditioned fixtures. These check declared equations, not hardware fidelity.

Detector phase is reported as undefined below a power of 1e−24 times emitted power (relative field amplitude 1e−12), where cancellation roundoff can make its angle meaningless. Calculated complex fields and powers are retained without clipping.
