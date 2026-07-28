# Interface contract

## Internal semantic graph

The saved PicSetup document is the source of truth for circuit topology, figure composition, component parameters, units, model versions, and provenance.

Components expose typed ports. Connections declare one of:

- `optical`
- `electrical`
- `rf`
- `control`
- `annotation`

The editor must reject incompatible port/domain combinations. Semantic JSON preserves the complete hybrid graph. SAX- and gdsfactory-oriented handoffs include only physical optical topology and must state that figure-only objects and non-optical links were omitted.

## OpticalSetup bridge: `setup-port/1`

The first cross-setup interface is a deterministic, versioned document handoff between a PicSetup optical boundary and OpticalSetup.

Every payload contains:

- `schema`: exactly `setup-port/1`;
- a stable bridge ID;
- source application, document, component ID, and component name;
- target application and URL;
- `domain`: exactly `optical`;
- interface kind and direction;
- a declared reference frame and orientation;
- wavelength in nanometres;
- PicSetup-side and OpticalSetup-side power in milliwatts;
- an explicit power reference and coupling efficiency;
- polarization, guided-mode label, boundary phase, and CW/pulsed timing;
- supported capabilities and explicit omissions;
- an optional return URL;
- a creation timestamp.

Allowed directions are `input`, `output`, and `bidirectional`. Supported interface kinds distinguish fiber mode, chip-edge mode, grating/free-space mode, and free-space beam boundaries.

The sender encodes JSON as base64url and opens the target with:

```text
?incomingBridge=<payload>&bridgeSchema=setup-port/1
```

Base64url is transport encoding, not encryption, authentication, or authorization. Bridge payloads must not contain secrets.

## Power and state boundary

The payload carries both interface-side powers and the coupling efficiency so the reference is inspectable. The receiver must not silently reinterpret one side's power as the other.

PicSetup exports a scalar guided-mode boundary. It does not invent or transfer beam waist, numerical aperture, sampled transverse field, wavefront, or laboratory coordinates. Those properties remain unresolved until OpticalSetup supplies them.

Phase is a declared boundary value in radians. CW/pulsed state includes repetition rate in megahertz and pulse duration in picoseconds only when pulsed. `createdAt` records document handoff time; it is not a shared simulation clock.

## Receiver and ownership

`app/integrations/opticalsetup/receiver-adapter.js` validates and normalizes the payload into a neutral boundary descriptor. It deliberately stops before scene creation.

OpticalSetup must map that descriptor into its own component and scene APIs, choose unresolved spatial state, and review/deploy the receiver in Luca Genchi's repository. PicSetup must not copy OpticalSetup private state or claim receiver deployment based on the sender adapter.

The initial interface is not live synchronization, co-simulation, or a distributed multi-physics solve. Stable bridge identity and a return URL allow later workflows without implying real-time authority.

## Evolution

Incompatible changes require a new schema identifier. Receivers must reject unsupported schema or domain values rather than guessing. Optional extensions must preserve the meaning and units of existing fields and keep unknown state explicit.
