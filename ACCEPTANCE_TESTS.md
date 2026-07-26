# PicSetup Detector Acceptance Tests

Run `npm test` and `npm run check`.

Automated acceptance requires exactly eight unique detector definitions and verifies each requested measurement family: camera spatial map/diameter/image, photodetector intensity, PMT weak-light estimate, power meter power, wavefront collimation/divergence, polarimeter Stokes state, spectrometer wavelength/bandwidth, and the general detector's complete readout plus pulse timing.

Browser acceptance on phone and desktop requires:

1. The detector catalog is usable by horizontal scrolling on mobile.
2. Selecting a detector does not display measurements until it is connected.
3. Connecting changes the endpoint and readout screen.
4. Only supported measurements and visuals appear.
5. Power, diameter, wavelength, divergence, and pulsed/CW controls update the readout immediately.
6. CW mode marks repetition rate and pulse duration unavailable.
7. Disconnect clears the screen.
8. The general detector displays its idealized-instrument caveat.
9. Keyboard focus and native controls remain usable.
10. Reduced-motion users receive the same state information without animation.

Circuit-graph connection, MZI output powers, save/reopen behavior, and solver reference planes remain separate acceptance work.
