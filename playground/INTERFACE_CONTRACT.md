# Interface contract — playground only

Versioned JSON documents contain a semantic circuit (stable component IDs, exact model version, parameters, connections and SI propagation settings, wavelength), independent layout (positions, rotations, curve controls, viewport), and explicit schema identifier. Bundled analytical model versions are exact; unsupported schemas/models and malformed references fail before replacing the current scene. Bound file bytes, component/connection counts, finite values and structural shape. Data is never evaluated as code.

Editor commands create validated atomic snapshots for undo/redo. Renderer never supplies physical lengths. Solver is headless and independent of DOM. Palette supports pointer and keyboard/click placement. Ports are explicit buttons for connection. Local autosave is recoverable, JSON export/import portable. Module/custom-model document support remains deferred, never silently dropped from imports.

No external bridge or runtime remote service. OpticalSetup ownership stays external. Later bridge work requires a separate versioned proposal with solved fields, units, conventions, reference planes and unknown spatial information.
