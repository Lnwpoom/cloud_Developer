# Alerts are driven by the declared origin; RPKI validation state is context

Although this is an RPKI project, the monitor raises alerts by comparing announcements against the operator's **declared origin**, and attaches the RFC 6811 **validation state** to each alert as supporting evidence rather than using it as the trigger. Driving alerts from RPKI alone misses every prefix whose owner has not published a ROA (NotFound) and is fooled by loose maxLength ROAs; driving them from declarations alone would drop RPKI entirely. Using both lets the demo show exactly where RPKI helps and where it falls short.

## Considered Options

- **RPKI only** (alert on Invalid/NotFound): rejected because it is blind to the NotFound gap and to forged-origin sub-prefixes under a loose ROA.
- **Declarations only** (BGPalerter-style): rejected because it removes the RPKI angle the project is about.
