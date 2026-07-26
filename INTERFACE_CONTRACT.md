# PicSetup Detector Interface Contract

Detector definitions use stable IDs and explicit capability strings. The UI must not infer measurements from a detector name.

`measureSignal(detectorId, opticalSignal)` returns the detector definition, supported readouts, optional visual payloads, and caveats. A disconnected detector returns no measurements at the screen layer. Signal-control changes recompute the connected detector immediately.

A future circuit node will connect one typed optical input port to a detector. The circuit solver remains the source of truth for the optical state at the detector reference plane. Electrical output dynamics belong to an explicit PicSetup electrical interface or ElectricalSetup and are not hidden inside this measurement function.

Before saved circuits depend on this interface, detector definitions and measurement payloads require schema versions and migration tests.
